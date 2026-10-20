/**
 * Avisa o CLIENTE que a data do job mudou. Server-side, sem sessão.
 *
 * ─── Por que saiu da rota ────────────────────────────────────────────────
 *
 * Isto morava dentro de `POST /api/jobs/[id]/notify-client-reschedule`, atrás
 * de `requireAuth()`. Ou seja: só existia para quem estava logado numa tela.
 * Agente nenhum conseguia avisar o cliente de uma remarcação, e é justamente o
 * agente que lê o e-mail da plataforma dizendo que a data mudou.
 *
 * É a mesma doença de todo o resto do OS: o aviso pendurado no lugar onde
 * alguém clicou, e não no fato que mudou. A rota continua existindo e agora
 * chama esta função — um caminho só, dois portões de entrada.
 *
 * ─── As duas caras do e-mail ─────────────────────────────────────────────
 *
 * Conta B2B recebe a moldura compacta que ela já conhece da confirmação: ela
 * nos manda job toda semana e não precisa que expliquem o serviço. Morador
 * recebe o layout de cliente, com espaço para motivo e para o tom de quem está
 * sendo remarcado, mais o WhatsApp com a data nova.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
import { enviarRescheduleDoCliente } from "@/lib/client-confirmation/reschedule-whatsapp";
import { buildClientJobRescheduledEmail } from "@/lib/emails/client-job-rescheduled";
import { confirmacaoPorWhatsApp, mensagensAoClienteLigadas } from "@/lib/client-confirmation/policy";
import { getZendeskTicketId, isZendeskConfigured } from "@/lib/zendesk";
import { avisarNoTicketDoJob } from "@/lib/um-ticket/aviso-do-job";
import { resolveNominalBillingParty } from "@/lib/account-billing-addressee";
import { buildJobRescheduledEmail, splitPropertyAddressAndPostcode } from "@/lib/zendesk-job-confirmation";
import { dataLonga, janelaTexto } from "@/lib/emails/fixfy-shell";

export interface AvisoDeRemarcacao {
  oldDateLine?: string | null;
  oldTimeLine?: string | null;
  newDateLine?: string | null;
  newTimeLine?: string | null;
  reason?: string | null;
  /** A Fixfy mudou a data (não o cliente). Sem saber, o e-mail não pede desculpas nem agradece. */
  iniciadoPelaFixfy?: boolean;
}

export type ResultadoAvisoCliente =
  | { ok: true; to: string; layout: "account" | "client"; ticketId?: number }
  | { ok: false; skipped: string }
  | { ok: false; error: string };

export async function avisarClienteDaRemarcacao(
  jobId: string,
  aviso: AvisoDeRemarcacao,
  client?: SupabaseClient,
): Promise<ResultadoAvisoCliente> {
  const supabase = client ?? createServiceClient();

  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, reference, title, property_address, client_id, client_name, client_reschedule_notified_at, scheduled_date, scheduled_start_at, scheduled_end_at, external_source, external_ref",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return { ok: false, error: "job_not_found" };
  const j = job as unknown as Record<string, unknown>;

  const clientId = typeof j.client_id === "string" ? j.client_id : "";
  if (!clientId) return { ok: false, skipped: "job has no client" };

  // Mesmo resolvedor de destinatário que fatura e orçamento usam: em conta B2B
  // o email vai para a conta, em B2C para o cliente.
  const billing = await resolveNominalBillingParty(supabase, {
    clientId,
    fallbackName: String(j.client_name ?? ""),
  });
  const para = billing.documentEmail?.trim() ?? "";
  if (!para) return { ok: false, skipped: "no email for this customer" };

  /**
   * A trava de mensagens vale para o MORADOR, não para a conta.
   *
   * `CLIENT_MESSAGING_ENABLED` segura mensagem a cliente final enquanto o
   * processo não foi validado. A conta é outra coisa: ela já recebe a
   * confirmação sem trava, e é ela quem prometeu uma data ao morador. Segurar
   * a remarcação dela era o pior dos dois mundos — a Housekeep sabia do job
   * quando foi marcado e não sabia quando mudou (JOB-9466, 20/08/2026).
   */
  const paraAConta = billing.mode === "account";
  if (!paraAConta && !mensagensAoClienteLigadas()) {
    return { ok: false, skipped: "client messaging is off (CLIENT_MESSAGING_ENABLED)" };
  }

  const key = process.env.RESEND_API_KEY?.trim();
  /**
   * No ticket do job, quando ele existe (dono, 14/10/2026): a remarcação entra
   * na mesma conversa da confirmação, com a data antiga riscada. A Resend fica
   * só para job sem ticket ou quando o Zendesk recusa.
   */
  const ticketRaw = isZendeskConfigured() ? getZendeskTicketId(j as never) : null;
  const ticketId = ticketRaw && /^\d+$/.test(String(ticketRaw)) ? Number(ticketRaw) : null;
  const pelaTicket = async (assunto: string, html: string): Promise<boolean> => {
    if (!ticketId) return false;
    try {
      await avisarNoTicketDoJob({ ticketId, para: { email: para, nome: billing.displayName || null }, assunto, html });
      return true;
    } catch (err) {
      console.error("[notify-client-reschedule] ticket:", err instanceof Error ? err.message : err);
      return false;
    }
  };
  if (!key && !ticketId) return { ok: false, skipped: "RESEND_API_KEY not set and job has no ticket" };

  const carimbar = async () => {
    // O lembrete de véspera precisa valer para a data NOVA, então o carimbo
    // dele é zerado aqui. Sem isto, job remarcado nunca receberia lembrete: a
    // varredura pula quem já tem `client_reminder_sent_at` preenchido.
    await supabase
      .from("jobs")
      .update({ client_reschedule_notified_at: new Date().toISOString(), client_reminder_sent_at: null })
      .eq("id", jobId);
  };

  /**
   * A data NOVA sai da linha do job (já gravada quando isto roda), no formato da
   * copy: `Wednesday 21 October 2026`, `between 9am and midday`. A linha que veio
   * no aviso só vale quando o job não tem a data.
   */
  const dataNova = dataLonga(typeof j.scheduled_date === "string" ? j.scheduled_date.slice(0, 10) : null) ?? aviso.newDateLine ?? "";
  const janelaNova = janelaTexto(j.scheduled_start_at as string | null, j.scheduled_end_at as string | null) ?? aviso.newTimeLine ?? "";

  if (paraAConta) {
    const { propertyAddress, propertyPostcode } = splitPropertyAddressAndPostcode(
      String(j.property_address ?? ""),
    );
    // B2B: "Hi {empresa} team,"; nunca o nome da pessoa de contato (handoff).
    let empresa: string | null = null;
    if (billing.sourceAccountId) {
      const { data: conta } = await supabase
        .from("accounts")
        .select("company_name")
        .eq("id", billing.sourceAccountId)
        .maybeSingle();
      empresa = (conta as { company_name?: string | null } | null)?.company_name?.trim() || null;
    }
    const email = buildJobRescheduledEmail({
      greetingName: empresa ?? "",
      publico: { tipo: "b2b", empresa },
      jobReference: String(j.reference ?? ""),
      jobTitle: String(j.title ?? ""),
      jobDate: dataNova,
      arrivalWindow: janelaNova,
      previousDate: aviso.oldDateLine ?? "",
      previousArrivalWindow: aviso.oldTimeLine ?? undefined,
      propertyAddress,
      propertyPostcode,
      typeOfWork: String(j.title ?? ""),
      iniciadoPelaFixfy: aviso.iniciadoPelaFixfy,
    });
    const assunto = email.subject;
    const html = email.html;
    if (await pelaTicket(assunto, html)) {
      await carimbar();
      return { ok: true, to: para, layout: "account", ticketId: ticketId ?? undefined };
    }
    if (!key) return { ok: false, error: "ticket delivery failed and RESEND_API_KEY not set" };
    try {
      const { error } = await new Resend(key).emails.send({
        from: process.env.RESEND_FROM_EMAIL?.trim() || "Fixfy <ops@getfixfy.com>",
        to: [para],
        subject: assunto,
        html,
        text: email.text,
      });
      if (error) return { ok: false, error: error.message ?? "send failed" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "send failed" };
    }
    await carimbar();
    return { ok: true, to: para, layout: "account" };
  }

  const primeiroNome = String(billing.displayName || j.client_name || "").trim().split(/\s+/)[0] || "";
  const email = buildClientJobRescheduledEmail({
    clientFirstName: primeiroNome,
    publico: { tipo: "b2c", primeiroNome },
    iniciadoPelaFixfy: aviso.iniciadoPelaFixfy,
    jobReference: String(j.reference ?? ""),
    jobTitle: String(j.title ?? ""),
    propertyAddress: String(j.property_address ?? ""),
    oldDateLine: aviso.oldDateLine ?? "",
    oldTimeLine: aviso.oldTimeLine ?? null,
    newDateLine: dataNova,
    newTimeLine: janelaNova || null,
    reason: aviso.reason ?? null,
  });

  const noTicket = await pelaTicket(email.subject, email.html);
  if (!noTicket) {
    if (!key) return { ok: false, error: "ticket delivery failed and RESEND_API_KEY not set" };
    try {
      const { error } = await new Resend(key).emails.send({
        from: process.env.RESEND_FROM_EMAIL?.trim() || "Fixfy <ops@getfixfy.com>",
        to: [para],
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      if (error) return { ok: false, error: error.message ?? "send failed" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "send failed" };
    }
  }

  // WhatsApp da remarcação só com CONFIRMACAO_WHATSAPP=on (dono, 14/10/2026:
  // "apenas por email for now"). Fire-and-forget: o e-mail já saiu.
  if (confirmacaoPorWhatsApp()) void enviarRescheduleDoCliente(supabase, {
    id: String(j.id),
    client_id: clientId,
    client_name: (j.client_name as string) ?? null,
    title: (j.title as string) ?? null,
    scheduled_date: (j.scheduled_date as string) ?? null,
    scheduled_start_at: (j.scheduled_start_at as string) ?? null,
    scheduled_end_at: (j.scheduled_end_at as string) ?? null,
  }).catch((e) => console.error("[notify-client-reschedule] whatsapp:", e));

  await carimbar();
  return { ok: true, to: para, layout: "client", ...(noTicket && ticketId ? { ticketId } : {}) };
}
