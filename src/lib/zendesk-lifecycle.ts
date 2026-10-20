/**
 * OS → Zendesk lifecycle side effects.
 *
 * The status custom_status_id is synced by `zendesk-status-sync.ts` (Fase 1+2).
 * This module fires the *one-shot* customer/partner notifications that should
 * accompany terminal/major lifecycle transitions:
 *
 *   - Job created from accepted quote → public reply on main ticket +
 *     partner side conversation ("Job confirmed").
 *   - Job awaiting payment (final check done) → short public reply ("Job done").
 *   - Job cancelled                   → short public reply ("Job cancelled").
 *   - Quote rejected                  → short public reply ("Quote closed").
 *
 * Each notice is idempotent via a `*_notice_sent_at` timestamp on the entity.
 * The functions accept either an explicit Supabase client (for callers that
 * already have one open) or build a service-role client lazily.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { syncAccountToZendesk } from "@/lib/zendesk-account-sync";
import { resolveJobCompletionInstant } from "@/lib/job-completion-anchor";
import { assinarFotos, urlsDeFoto } from "@/lib/stefane/run-external-report";
import { baixarFotosDoJob } from "@/lib/emails/fotos-anexadas";
import { avisarNoTicketDoJob } from "@/lib/um-ticket/aviso-do-job";
import { resolveNominalBillingParty } from "@/lib/account-billing-addressee";
import {
  getZendeskTicketId,
  getTicketRequester,
  ticketDoWhatsApp,
  setTicketRequester,
  isZendeskConfigured,
  updateTicket as zdUpdateTicket,
} from "@/lib/zendesk";
import {
  buildJobCancelled,
  buildJobCompleted,
  buildQuoteRejected,
  publicoDoAviso,
} from "@/lib/zendesk-lifecycle-templates";
import {
  buildJobConfirmationHtml,
  formatJobConfirmationArrivalWindow,
  formatJobConfirmationLongDate,
  loadAccountOrganizationName,
  resolveCustomerGreetingName,
  splitPropertyAddressAndPostcode,
} from "@/lib/zendesk-job-confirmation";

type PartnerEmbed = {
  company_name?: string | null;
  contact_name?: string | null;
  email?: string | null;
  zendesk_user_id?: number | string | null;
};

const CLIENT_CONFIRMATION_STATUSES = new Set(["scheduled", "late"]);

export async function resolveJobTypeOfWorkLabel(
  supabase: SupabaseClient,
  catalogServiceId: string | null | undefined,
  title: string | null | undefined,
): Promise<string> {
  const id = catalogServiceId?.trim();
  if (id) {
    const { data } = await supabase
      .from("service_catalog")
      .select("name")
      .eq("id", id)
      .maybeSingle();
    const name = (data as { name?: string | null } | null)?.name?.trim();
    if (name) return name;
  }
  return title?.trim() || "Maintenance";
}

/**
 * Carrega o parceiro do job numa consulta própria.
 *
 * Era um embed `partners ( … )` dentro do select do job, e o embed nunca
 * funcionou: não existe relação declarada entre `jobs` e `partners` no schema
 * cache, então o PostgREST devolvia "Could not find a relationship" e a função
 * inteira saía por `if (error || !job) return { ok: false }`. Em silêncio, e
 * desde sempre: nenhuma confirmação de job chegou ao cliente por causa disto.
 */
async function carregarParceiro(
  supabase: SupabaseClient,
  partnerId: string | null | undefined,
): Promise<{ email: string; name: string; zendeskUserId?: string }> {
  const vazio = { email: "", name: "" };
  const id = partnerId?.trim();
  if (!id) return vazio;

  const { data } = await supabase
    .from("partners")
    .select("company_name, contact_name, email, zendesk_user_id")
    .eq("id", id)
    .maybeSingle();
  const p = data as PartnerEmbed | null;
  if (!p) return vazio;

  return {
    email: p.email?.trim() ?? "",
    name: p.company_name?.trim() || p.contact_name?.trim() || "",
    zendeskUserId: p.zendesk_user_id != null ? String(p.zendesk_user_id) : undefined,
  };
}

// ─── Job creation (accept flow) ──────────────────────────────────────────────

/**
 * Post the customer-facing booking confirmation on the main Zendesk ticket
 * and, if a partner is assigned, open a "Job confirmed" side conversation.
 * Safe to call from any server context — silent no-op when not configured.
 */
export async function dispatchJobCreatedZendesk(args: {
  jobId: string;
  client?: SupabaseClient;
}): Promise<{ ok: boolean; mainPosted?: boolean; sideConvId?: string | null; skipped?: string; error?: string }> {
  const supabase = args.client ?? createServiceClient();

  const { data: job, error } = await supabase
    .from("jobs")
    .select(`
      id, reference, title, property_address, scope, status,
      scheduled_date, scheduled_start_at, scheduled_end_at,
      catalog_service_id,
      external_source, external_ref, partner_id, partner_confirmed_at, client_id,
      zendesk_side_conversation_id,
      job_creation_notice_sent_at,
      clients ( full_name )
    `)
    .eq("id", args.jobId)
    .maybeSingle();

  if (error || !job) {
    return { ok: false, error: error?.message ?? "Job not found" };
  }

  const ticketId = getZendeskTicketId(job);
  if (!ticketId) return { ok: true };
  if (!isZendeskConfigured()) return { ok: true };

  if ((job as { job_creation_notice_sent_at?: string | null }).job_creation_notice_sent_at) {
    return { ok: true };
  }

  const jobStatus = String((job as { status?: string | null }).status ?? "");
  const dateStr = String(job.scheduled_date ?? "").slice(0, 10);
  if (!CLIENT_CONFIRMATION_STATUSES.has(jobStatus) || !dateStr) {
    return { ok: true, skipped: "not_scheduled" };
  }

  // Idempotent claim — only after we know the job is booked. Unassigned jobs
  // created in the OS skip here without claiming so a later transition to
  // scheduled can still send the customer confirmation.
  const { data: claimed } = await supabase
    .from("jobs")
    .update({ job_creation_notice_sent_at: new Date().toISOString() })
    .eq("id", args.jobId)
    .is("job_creation_notice_sent_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: true };

  // `full_name`, não `name`: nenhuma tabela deste banco chama a coluna de nome
  // de `name` (é `full_name` em clients, `company_name` em accounts e
  // partners). O `clients ( name )` que estava aqui derrubava a query inteira.
  type ClientRel = { full_name?: string | null };
  const clientRowRaw = (job as unknown as { clients?: ClientRel | ClientRel[] | null }).clients;
  const clientRow: ClientRel | null = Array.isArray(clientRowRaw) ? (clientRowRaw[0] ?? null) : (clientRowRaw ?? null);
  const clientNameFallback = clientRow?.full_name ?? "";

  // Resolve the customer-facing recipient the same way quotes/invoices do — the
  // account's billing_type decides between the account email (B2B) and the end
  // client's email (B2C). Keeps job confirmation consistent with every other
  // customer send.
  const jobClientId = (job as { client_id?: string | null }).client_id?.trim() ?? "";
  const billing = await resolveNominalBillingParty(supabase, {
    clientId: jobClientId,
    fallbackName: clientNameFallback,
  });
  const clientName = billing.displayName || clientNameFallback;
  const clientEmail = billing.documentEmail?.trim() ?? "";
  const clientAccountId = billing.sourceAccountId?.trim() ?? "";

  const organizationName = await loadAccountOrganizationName(supabase, clientAccountId);

  const greetingName = resolveCustomerGreetingName(organizationName, clientName);
  const { propertyAddress, propertyPostcode } = splitPropertyAddressAndPostcode(
    String(job.property_address ?? ""),
  );
  const typeOfWork = await resolveJobTypeOfWorkLabel(
    supabase,
    (job as { catalog_service_id?: string | null }).catalog_service_id,
    String(job.title ?? ""),
  );

  const html = buildJobConfirmationHtml({
    greetingName,
    jobReference: String(job.reference ?? ""),
    jobTitle: String(job.title ?? "Maintenance job"),
    jobDate: formatJobConfirmationLongDate(dateStr),
    arrivalWindow: formatJobConfirmationArrivalWindow({
      scheduled_start_at: job.scheduled_start_at,
      scheduled_end_at: (job as { scheduled_end_at?: string | null }).scheduled_end_at,
    }),
    propertyAddress,
    propertyPostcode,
    typeOfWork,
  });

  // Make the booking confirmation reach the CUSTOMER on this ticket. Jobs
  // created in the OS open a ticket with team@getfixfy.com as requester (and a
  // private opening note), so a public comment would land in the team inbox.
  // Flip the requester to the customer (only when the ticket is still the
  // internal team@ one — never hijack a macro/quote-origin ticket that already
  // has a real customer) and file it under the account's Zendesk organization.
  // Mirrors the quote send-pdf flow.
  const TEAM_REQUESTER = "team@getfixfy.com";
  // Job pago na conversa do Harvey usa o ticket do WhatsApp: lá o solicitante já
  // é o cliente e comentário público sai no WhatsApp dele. A confirmação vira
  // nota interna (dono, 07/10/2026) e o solicitante não muda.
  const viaWhatsApp = await ticketDoWhatsApp(ticketId);
  if (!viaWhatsApp && clientEmail.includes("@") && clientEmail.toLowerCase() !== TEAM_REQUESTER) {
    try {
      const cur = await getTicketRequester(ticketId);
      if (cur.ok && cur.requesterEmail === TEAM_REQUESTER) {
        let orgId: string | null = null;
        if (clientAccountId) {
          const { data: acct } = await supabase
            .from("accounts")
            .select("zendesk_organization_id")
            .eq("id", clientAccountId)
            .maybeSingle();
          orgId = (acct as { zendesk_organization_id?: string | null } | null)?.zendesk_organization_id ?? null;
          if (!orgId) {
            const sync = await syncAccountToZendesk(clientAccountId);
            orgId = sync.ok ? (sync.organizationId ?? null) : null;
          }
        }
        /**
         * `entityId` é o CLIENTE, nunca a conta.
         *
         * Era `clientAccountId || String(job.id)`, e o `external_id` do usuário
         * Zendesk é montado a partir dele: `fixfy:account-contact:<entityId>`.
         * Com o id da conta, todo cliente da mesma organização recebia o MESMO
         * external_id — e o `create_or_update` do Zendesk casa por external_id
         * antes do e-mail. Resultado: um único end-user acumulando o e-mail de
         * cada cliente como identidade nova, com o nome sobrescrito pelo último.
         *
         * Em 07/09/2026 esse usuário tinha 22 e-mails de clientes diferentes da
         * Checkatrade e se chamava "Sarah Rudd", com o e-mail do Alun como
         * primário. Toda resposta pública nesses tickets ia para o Alun.
         *
         * O `send-pdf` das quotes sempre fez certo: client_id primeiro.
         */
        const set = await setTicketRequester({
          ticketId,
          email:          clientEmail,
          name:           clientName || null,
          entityId:       jobClientId || String(job.id),
          organizationId: orgId ?? undefined,
        });
        if (!set.ok) {
          console.warn("[zendesk-lifecycle] dispatchJobCreated setTicketRequester failed:", set.error);
        }
      } else if (!cur.ok) {
        console.warn(
          "[zendesk-lifecycle] dispatchJobCreated could not read requester for ticket", ticketId,
          "— skipping reassignment (conservative).", cur.error,
        );
      }
    } catch (err) {
      console.error("[zendesk-lifecycle] dispatchJobCreated requester reassignment failed:", err);
    }
  }

  let mainPosted = false;
  try {
    await zdUpdateTicket({ ticketId, htmlBody: html, publicComment: !viaWhatsApp });
    mainPosted = true;
  } catch (err) {
    console.error("[zendesk-lifecycle] dispatchJobCreated main reply failed:", err);
  }

  // Ticket de WhatsApp: a confirmação acima é nota interna; o cliente ouve uma linha curta
  // na conversa (16/10/2026). Falha ou janela fechada vira nota, nunca derruba o dispatch.
  if (viaWhatsApp) {
    try {
      const { confirmarJobNoWhatsApp } = await import("@/lib/harvey-wa/confirmacao-no-whatsapp");
      const r = await confirmarJobNoWhatsApp(supabase, {
        ticketId: Number(ticketId),
        dia: formatJobConfirmationLongDate(dateStr),
        janela: formatJobConfirmationArrivalWindow({
          scheduled_start_at: job.scheduled_start_at,
          scheduled_end_at: (job as { scheduled_end_at?: string | null }).scheduled_end_at,
        }),
        referencia: String(job.reference ?? ""),
      });
      if (!r.enviado) {
        await zdUpdateTicket({
          ticketId,
          htmlBody: `<p>WhatsApp confirmation not sent: ${r.motivo ?? "unknown reason"}. Confirm with the customer by phone or template.</p>`,
          publicComment: false,
        }).catch(() => undefined);
      }
    } catch (err) {
      console.error("[zendesk-lifecycle] WhatsApp confirmation failed:", err);
    }
  }

  // Partner side conv here only when a partner is on the job but not yet office-confirmed
  // (e.g. quote accept). Create Job with a manual partner sets partner_confirmed_at and
  // fires `assigned` via notifyPartnerJobZendesk — skip to avoid a duplicate thread.
  const sideConvId: string | null =
    (job as { zendesk_side_conversation_id?: string | null }).zendesk_side_conversation_id ?? null;

  const { email: partnerEmail, name: partnerName, zendeskUserId } = await carregarParceiro(
    supabase,
    (job as { partner_id?: string | null }).partner_id,
  );
  const partnerConfirmed = Boolean(
    (job as { partner_confirmed_at?: string | null }).partner_confirmed_at,
  );

  /**
   * A segunda mensagem ao parceiro saiu daqui em 21/08/2026.
   *
   * O parceiro recebia DUAS para o mesmo job, com dois minutos de diferença: a
   * com a nossa marca, vinda do aceite, e esta, sem cabeçalho e com emoji no
   * lugar dos rótulos. Mesmo fato, mesma pessoa, duas caixas de entrada.
   *
   * O guarda que deveria evitar isso era `!partnerConfirmed`, e ele partia de
   * uma premissa que a operação desmentiu: que o parceiro clica em Accept. Em
   * 20/08 eram 15 de 16 jobs agendados SEM `partner_confirmed_at` — o mesmo
   * fato que fez a escalação automática soltar o quadro inteiro. Com a
   * confirmação quase sempre ausente, o guarda quase nunca segurava e a
   * duplicata virou a regra, não a exceção.
   *
   * Nada se perde ao remover: quem cria a side conversation e grava
   * `zendesk_side_conversation_id` é o caminho de aceite
   * (`job-partner-acceptance`) e o de convite (`auto-assign-job-invites`), e o
   * link do relatório vai na mensagem deles.
   */
  void partnerConfirmed;
  void partnerEmail;
  void partnerName;
  void zendeskUserId;

  // job_creation_notice_sent_at was already claimed atomically at the top.
  return { ok: true, mainPosted, sideConvId };
}

// ─── Terminal lifecycle notices ──────────────────────────────────────────────

async function dispatchJobTerminalNotice(args: {
  jobId: string;
  status: "awaiting_payment" | "cancelled";
  client?: SupabaseClient;
}): Promise<{ ok: boolean; posted?: boolean; error?: string }> {
  const supabase = args.client ?? createServiceClient();
  const sentColumn =
    args.status === "awaiting_payment" ? "completion_notice_sent_at" : "cancellation_notice_sent_at";

  const { data: job, error } = await supabase
    .from("jobs")
    .select(`
      id, reference, title, status,
      external_source, external_ref, partner_id, zendesk_side_conversation_id,
      cancellation_reason, cancellation_notice_sent_at, completion_notice_sent_at,
      client_id, client_name, final_report, partner_timer_ended_at, completed_date,
      scheduled_date, scheduled_start_at, property_address, catalog_service_id,
      clients ( full_name, source_account_id )
    `)
    .eq("id", args.jobId)
    .maybeSingle();

  if (error || !job) {
    return { ok: false, error: error?.message ?? "Job not found" };
  }
  const ticketId = getZendeskTicketId(job);
  if (!ticketId) return { ok: true };
  if (!isZendeskConfigured()) return { ok: true };
  if (job.status !== args.status) return { ok: true }; // status drifted — skip
  if ((job as Record<string, unknown>)[sentColumn]) return { ok: true };

  // Job concluído: e-mail no ticket do job, com as fotos do relatório (dono, 14/10/2026).
  if (args.status === "awaiting_payment") {
    return enviarAvisoDeConclusao(supabase, job as unknown as JobDaConclusao, Number(ticketId));
  }

  /**
   * A nota é pública: quem recebe é o requester do ticket, que num job de conta
   * é a CONTA. Cumprimentar o morador aqui manda o nome dele para o parceiro
   * B2B e trata a conta como cliente final. Ver `zendesk-notice-addressee`.
   */
  const clientRowRaw = (job as unknown as {
    clients?: { full_name?: string | null; source_account_id?: string | null }
      | { full_name?: string | null; source_account_id?: string | null }[] | null;
  }).clients;
  const clientRow = Array.isArray(clientRowRaw) ? (clientRowRaw[0] ?? null) : (clientRowRaw ?? null);
  const orgName = await loadAccountOrganizationName(supabase, clientRow?.source_account_id);
  const servico = await resolveJobTypeOfWorkLabel(
    supabase,
    (job as { catalog_service_id?: string | null }).catalog_service_id,
    String(job.title ?? ""),
  );

  const { html } = buildJobCancelled({
    publico: publicoDoAviso(orgName, clientRow?.full_name ?? job.client_name ?? ""),
    reference: String(job.reference ?? ""),
    service: servico,
    propertyAddress: (job as { property_address?: string | null }).property_address ?? null,
    visitDate: (job as { scheduled_date?: string | null }).scheduled_date ?? null,
  });

  try {
    // Ticket do WhatsApp (job pago na conversa do Harvey): nota interna, como a confirmação.
    await zdUpdateTicket({ ticketId, htmlBody: html, publicComment: !(await ticketDoWhatsApp(ticketId)) });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Partner "Job cancelled" email is sent via notifyPartnerJobZendesk (office cancel /
  // useCancelJob). This lifecycle step only posts the public customer notice on the ticket.

  await supabase.from("jobs").update({ [sentColumn]: new Date().toISOString() }).eq("id", args.jobId);
  return { ok: true, posted: true };
}

/** Passou disso desde o fim do trabalho, o aviso não sai: é job antigo, não notícia. */
const CONCLUSAO_JANELA_DIAS = 7;

type JobDaConclusao = {
  id: string;
  reference: string | null;
  title: string | null;
  client_id: string | null;
  client_name: string | null;
  final_report: unknown;
  partner_timer_ended_at: string | null;
  completed_date: string | null;
  scheduled_date: string | null;
  scheduled_start_at: string | null;
  property_address?: string | null;
  catalog_service_id?: string | null;
  clients?: { full_name?: string | null; source_account_id?: string | null } | { full_name?: string | null; source_account_id?: string | null }[] | null;
};

/**
 * "Job concluído" ao cliente (dono, 14/10/2026: "envia email mesmo ticket pra
 * todos com job concluido e fotos de report"). Liga sozinho; desliga com
 * `JOB_COMPLETION_NOTICE_ENABLED=0`.
 *
 * Era um comentário público sem fotos, desligado desde 14/09 porque no job de
 * conta o requester é a plataforma. Agora o destinatário sai do mesmo
 * resolvedor da fatura (conta no B2B, cliente no B2C) e a entrega é a do
 * `avisarNoTicketDoJob`: comentário público se ele é o requester, senão
 * conversa lateral no mesmo ticket.
 *
 * Os jobs que já estavam em Awaiting Payment não recebem nada de surpresa:
 * passou de 7 dias desde o fim do trabalho, não sai.
 */
async function enviarAvisoDeConclusao(
  supabase: SupabaseClient,
  job: JobDaConclusao,
  ticketId: number,
): Promise<{ ok: boolean; posted?: boolean; skipped?: string; error?: string }> {
  if (process.env.JOB_COMPLETION_NOTICE_ENABLED?.trim() === "0") return { ok: true, skipped: "off" };
  if (!Number.isFinite(ticketId) || ticketId <= 0) return { ok: true, skipped: "no_ticket" };

  const fim = resolveJobCompletionInstant(job as never);
  if (fim && Date.now() - fim.getTime() > CONCLUSAO_JANELA_DIAS * 86_400_000) {
    return { ok: true, skipped: "finished_more_than_7_days_ago" };
  }

  // Trava antes de mandar: o sync-status pode chegar duas vezes no mesmo minuto.
  const { data: claimed } = await supabase
    .from("jobs")
    .update({ completion_notice_sent_at: new Date().toISOString() })
    .eq("id", job.id)
    .is("completion_notice_sent_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: true, skipped: "already_sent" };

  try {
    const relRaw = job.clients;
    const rel = Array.isArray(relRaw) ? (relRaw[0] ?? null) : (relRaw ?? null);
    const billing = await resolveNominalBillingParty(supabase, {
      clientId: job.client_id ?? "",
      fallbackName: rel?.full_name ?? job.client_name ?? "",
    });
    const orgName = await loadAccountOrganizationName(supabase, rel?.source_account_id);
    const servico = await resolveJobTypeOfWorkLabel(supabase, job.catalog_service_id, job.title);

    // Fotos do "depois", assinadas (o bucket é privado) e anexadas: até 6.
    const assinadas = await assinarFotos(supabase, urlsDeFoto(job.final_report)).catch(() => [] as string[]);
    const fotos = await baixarFotosDoJob(assinadas);
    const anexos = fotos.map((f, i) => ({
      filename: `${job.reference ?? "job"}-after-${i + 1}.${f.filename.split(".").pop() ?? "jpg"}`,
      content: f.bytes,
      contentType: f.contentType,
    }));

    // Sem frase de fatura: o aviso não sabe se a conta recebe fatura (email_include_invoice_on_final).
    const aviso = buildJobCompleted({
      publico: publicoDoAviso(orgName, billing.displayName || rel?.full_name || job.client_name || ""),
      reference: String(job.reference ?? ""),
      service: servico,
      propertyAddress: job.property_address ?? null,
      photoCount: anexos.length,
    });
    await avisarNoTicketDoJob({
      ticketId,
      para: { email: billing.documentEmail ?? null, nome: billing.displayName || null },
      assunto: aviso.assunto,
      html: aviso.html,
      anexos,
    });
    return { ok: true, posted: true };
  } catch (err) {
    // Devolve a trava: a próxima sincronização tenta de novo.
    await supabase.from("jobs").update({ completion_notice_sent_at: null }).eq("id", job.id);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function dispatchJobCompletedZendesk(jobId: string, client?: SupabaseClient) {
  return dispatchJobTerminalNotice({ jobId, status: "awaiting_payment", client });
}

export function dispatchJobCancelledZendesk(jobId: string, client?: SupabaseClient) {
  return dispatchJobTerminalNotice({ jobId, status: "cancelled", client });
}

export async function dispatchQuoteRejectedZendesk(
  quoteId: string,
  client?: SupabaseClient,
): Promise<{ ok: boolean; posted?: boolean; error?: string }> {
  const supabase = client ?? createServiceClient();

  const { data: quote, error } = await supabase
    .from("quotes")
    .select(`
      id, reference, status, title, catalog_service_id,
      external_source, external_ref,
      rejection_reason, rejection_notice_sent_at,
      clients ( full_name, source_account_id )
    `)
    .eq("id", quoteId)
    .maybeSingle();

  if (error || !quote) {
    return { ok: false, error: error?.message ?? "Quote not found" };
  }
  const ticketId = getZendeskTicketId(quote);
  if (!ticketId) return { ok: true };
  if (!isZendeskConfigured()) return { ok: true };
  if (quote.status !== "rejected") return { ok: true };
  if ((quote as { rejection_notice_sent_at?: string | null }).rejection_notice_sent_at) {
    return { ok: true };
  }

  // Mesma razão do aviso de job: a nota pública fala com a conta, não com o morador.
  const clientRowRaw = (quote as unknown as {
    clients?: { full_name?: string | null; source_account_id?: string | null }
      | { full_name?: string | null; source_account_id?: string | null }[] | null;
  }).clients;
  const clientRow = Array.isArray(clientRowRaw) ? (clientRowRaw[0] ?? null) : (clientRowRaw ?? null);
  const orgName = await loadAccountOrganizationName(supabase, clientRow?.source_account_id);
  const servico = await resolveJobTypeOfWorkLabel(
    supabase,
    (quote as { catalog_service_id?: string | null }).catalog_service_id,
    (quote as { title?: string | null }).title ?? "",
  );

  // A nota de recusa (rejection_reason) fica só no OS: não volta automaticamente ao cliente.
  const aviso = buildQuoteRejected({
    publico: publicoDoAviso(orgName, clientRow?.full_name ?? ""),
    reference: String(quote.reference ?? ""),
    service: servico,
  });

  try {
    // Ticket de WhatsApp recebe texto puro, nunca HTML. Continua comentário público, como antes.
    const viaWhatsApp = await ticketDoWhatsApp(ticketId);
    await zdUpdateTicket(
      viaWhatsApp
        ? { ticketId, commentBody: aviso.whatsapp, publicComment: true }
        : { ticketId, htmlBody: aviso.html, publicComment: true },
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  await supabase
    .from("quotes")
    .update({ rejection_notice_sent_at: new Date().toISOString() })
    .eq("id", quoteId);

  return { ok: true, posted: true };
}
