/**
 * Avisa os dois lados que o preço do job mudou. Server-side, sem sessão.
 *
 * Mesmo molde da remarcação:
 *  - CLIENTE: destinatário pelo `resolveNominalBillingParty` (conta em B2B,
 *    cliente em B2C); B2C só com `mensagensAoClienteLigadas()`; entra no ticket
 *    do job quando ele existe, Resend como reserva; B2B "Hi {empresa} team".
 *  - PARCEIRO: conversa lateral no ticket do job (como o aviso de remarcação
 *    ao parceiro), Resend quando o job não tem ticket ou o Zendesk recusa.
 *
 * Cada lado só sai se o SEU valor mudou (≥ £0.01). Um lado falhar nunca
 * derruba o outro, e nada aqui lança: cada lado volta ok / skipped / error.
 *
 * O e-mail do cliente só recebe o dinheiro do cliente e o do parceiro só o do
 * parceiro (ver `emails/job-price-changed.ts`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
import { mensagensAoClienteLigadas } from "@/lib/client-confirmation/policy";
import { createSideConversation, getZendeskTicketId, isZendeskConfigured } from "@/lib/zendesk";
import { avisarNoTicketDoJob } from "@/lib/um-ticket/aviso-do-job";
import { resolveNominalBillingParty } from "@/lib/account-billing-addressee";
import { partnerEmailGreetingName } from "@/lib/emails/partner-greeting-name";
import { resolvePartnerTradePortalBaseUrl } from "@/lib/trade-auth";
import {
  buildClientJobPriceChangedEmail,
  buildPartnerJobPriceChangedEmail,
  type PriceChangeBilling,
} from "@/lib/emails/job-price-changed";
import type { Publico } from "@/lib/emails/fixfy-shell";

const REMETENTE = "Fixfy Team <no-reply@getfixfy.com>";
const RESPOSTA_CLIENTE = "hello@getfixfy.com";
const RESPOSTA_PARCEIRO = "support@getfixfy.com";

export type ValoresDoPreco = { client: number | null; partner: number | null };

export type MudancaDePreco = {
  antes: ValoresDoPreco;
  depois: ValoresDoPreco;
  billing: PriceChangeBilling;
  /** Taxas por hora (jobs hourly) e horas estimadas. Cada lado só vê a sua. */
  taxas?: {
    antes?: { client?: number | null; partner?: number | null } | null;
    depois?: { client?: number | null; partner?: number | null } | null;
    horas?: number | null;
  } | null;
};

export type ResultadoAvisoDePreco =
  | { ok: true; to: string; via: "ticket" | "resend"; ticketId?: number | string; layout?: "account" | "client" }
  | { ok: false; skipped: string }
  | { ok: false; error: string };

export type ResultadoMudancaDePreco = {
  client: ResultadoAvisoDePreco;
  partner: ResultadoAvisoDePreco;
};

const num = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);

/** Mudou de verdade: os dois valores existem e diferem em pelo menos £0.01. */
export function precoMudou(antes: number | null | undefined, depois: number | null | undefined): boolean {
  const a = num(antes);
  const d = num(depois);
  if (a == null || d == null) return false;
  return Math.abs(Math.round(a * 100) - Math.round(d * 100)) >= 1;
}

type JobDoPreco = {
  id: string;
  reference: string | null;
  title: string | null;
  property_address: string | null;
  client_id: string | null;
  client_name: string | null;
  partner_id: string | null;
  external_source: string | null;
  external_ref: string | null;
};

export async function avisarMudancaDePreco(
  jobId: string,
  mudanca: MudancaDePreco,
  client?: SupabaseClient,
): Promise<ResultadoMudancaDePreco> {
  let supabase: SupabaseClient;
  try {
    supabase = client ?? createServiceClient();
  } catch (err) {
    const error = err instanceof Error ? err.message : "supabase unavailable";
    return { client: { ok: false, error }, partner: { ok: false, error } };
  }

  let job: JobDoPreco | null = null;
  try {
    const { data } = await supabase
      .from("jobs")
      .select("id, reference, title, property_address, client_id, client_name, partner_id, external_source, external_ref")
      .eq("id", jobId)
      .maybeSingle();
    job = (data as JobDoPreco | null) ?? null;
  } catch (err) {
    const error = err instanceof Error ? err.message : "job lookup failed";
    return { client: { ok: false, error }, partner: { ok: false, error } };
  }
  if (!job) return { client: { ok: false, error: "job_not_found" }, partner: { ok: false, error: "job_not_found" } };

  const billing: PriceChangeBilling = mudanca.billing === "hourly" ? "hourly" : "fixed";

  const [clientRes, partnerRes] = await Promise.all([
    avisarLadoDoCliente(supabase, job, mudanca, billing).catch(
      (err): ResultadoAvisoDePreco => ({ ok: false, error: err instanceof Error ? err.message : "client notice failed" }),
    ),
    avisarLadoDoParceiro(supabase, job, mudanca, billing).catch(
      (err): ResultadoAvisoDePreco => ({ ok: false, error: err instanceof Error ? err.message : "partner notice failed" }),
    ),
  ]);
  return { client: clientRes, partner: partnerRes };
}

// ─── Entrega genérica (preço, endereço, cliente) ─────────────────────────

export type EmailPronto = { subject: string; html: string; text: string };

export type JobDoAviso = JobDoPreco;

export const COLUNAS_DO_JOB_DO_AVISO =
  "id, reference, title, property_address, client_id, client_name, partner_id, external_source, external_ref";

/**
 * Entrega ao lado do cliente: conta em B2B, morador em B2C (com a trava de
 * mensagens), no ticket do job quando existe, Resend como reserva.
 */
export async function entregarAoCliente(
  supabase: SupabaseClient,
  job: JobDoAviso,
  montar: (publico: Publico) => EmailPronto,
  tag = "notify-job",
): Promise<ResultadoAvisoDePreco> {
  const clientId = job.client_id ?? "";
  if (!clientId) return { ok: false, skipped: "job has no client" };

  const quem = await resolveNominalBillingParty(supabase, {
    clientId,
    fallbackName: String(job.client_name ?? ""),
  });
  const para = quem.documentEmail?.trim() ?? "";
  if (!para) return { ok: false, skipped: "no email for this customer" };

  // A trava de mensagens vale para o MORADOR, não para a conta (igual à remarcação).
  const paraAConta = quem.mode === "account";
  if (!paraAConta && !mensagensAoClienteLigadas()) {
    return { ok: false, skipped: "client messaging is off (CLIENT_MESSAGING_ENABLED)" };
  }

  let publico: Publico;
  if (paraAConta) {
    let empresa: string | null = null;
    if (quem.sourceAccountId) {
      const { data: conta } = await supabase
        .from("accounts")
        .select("company_name")
        .eq("id", quem.sourceAccountId)
        .maybeSingle();
      empresa = (conta as { company_name?: string | null } | null)?.company_name?.trim() || null;
    }
    publico = { tipo: "b2b", empresa };
  } else {
    const primeiroNome = String(quem.displayName || job.client_name || "").trim().split(/\s+/)[0] || "";
    publico = { tipo: "b2c", primeiroNome };
  }
  const layout = paraAConta ? "account" : "client";
  const email = montar(publico);

  const ticketRaw = isZendeskConfigured() ? getZendeskTicketId(job) : null;
  const ticketId = ticketRaw && /^\d+$/.test(String(ticketRaw)) ? Number(ticketRaw) : null;
  if (ticketId) {
    try {
      await avisarNoTicketDoJob({ ticketId, para: { email: para, nome: quem.displayName || null }, assunto: email.subject, html: email.html });
      return { ok: true, to: para, via: "ticket", ticketId, layout };
    } catch (err) {
      console.error(`[${tag}] client ticket:`, err instanceof Error ? err.message : err);
    }
  }

  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    return ticketId
      ? { ok: false, error: "ticket delivery failed and RESEND_API_KEY not set" }
      : { ok: false, skipped: "RESEND_API_KEY not set and job has no ticket" };
  }
  try {
    const { error } = await new Resend(key).emails.send({
      from: REMETENTE,
      to: [para],
      replyTo: RESPOSTA_CLIENTE,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    if (error) return { ok: false, error: error.message ?? "send failed" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "send failed" };
  }
  return { ok: true, to: para, via: "resend", layout };
}

/**
 * Entrega ao parceiro do job: conversa lateral NOVA no ticket do job (sem
 * mexer na do job booked), Resend quando não tem ticket ou o Zendesk recusa.
 */
export async function entregarAoParceiro(
  supabase: SupabaseClient,
  job: JobDoAviso,
  montar: (a: { primeiroNome: string | null; jobUrl: string }) => EmailPronto,
  tag = "notify-job",
): Promise<ResultadoAvisoDePreco> {
  if (!job.partner_id) return { ok: false, skipped: "job has no partner" };

  const { data: partnerRow } = await supabase.from("partners").select("*").eq("id", job.partner_id).maybeSingle();
  const partner = partnerRow as {
    id: string;
    contact_name: string | null;
    company_name: string | null;
    email: string | null;
    zendesk_user_id: string | null;
    job_cc_emails?: string[] | null;
  } | null;
  if (!partner) return { ok: false, skipped: "partner not found" };
  const para = partner.email?.trim() ?? "";
  if (!para) return { ok: false, skipped: "partner has no email" };
  const extras = (partner.job_cc_emails ?? [])
    .map((e) => String(e).trim().toLowerCase())
    .filter((e) => /.+@.+\..+/.test(e) && e !== para.toLowerCase());

  const email = montar({ primeiroNome: partnerEmailGreetingName(partner), jobUrl: resolvePartnerTradePortalBaseUrl() });

  const ticketId = job.external_source === "zendesk" && job.external_ref ? String(job.external_ref) : null;
  if (ticketId && isZendeskConfigured()) {
    try {
      const r = await createSideConversation({
        ticketId,
        toEmail: para,
        toName: partner.contact_name || partner.company_name || undefined,
        toUserId: partner.zendesk_user_id ?? undefined,
        extraEmails: extras,
        subject: email.subject,
        htmlBody: email.html,
        bodyText: email.text,
      });
      if (r.ok) return { ok: true, to: para, via: "ticket", ticketId };
      console.error(`[${tag}] partner side conversation:`, r.error);
    } catch (err) {
      console.error(`[${tag}] partner side conversation:`, err instanceof Error ? err.message : err);
    }
  }

  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    return ticketId
      ? { ok: false, error: "ticket delivery failed and RESEND_API_KEY not set" }
      : { ok: false, skipped: "RESEND_API_KEY not set and job has no ticket" };
  }
  try {
    const { error } = await new Resend(key).emails.send({
      from: REMETENTE,
      to: [para],
      ...(extras.length ? { cc: extras } : {}),
      replyTo: RESPOSTA_PARCEIRO,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    if (error) return { ok: false, error: error.message ?? "send failed" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "send failed" };
  }
  return { ok: true, to: para, via: "resend" };
}

// ─── Preço ───────────────────────────────────────────────────────────────

async function avisarLadoDoCliente(
  supabase: SupabaseClient,
  job: JobDoPreco,
  mudanca: MudancaDePreco,
  billing: PriceChangeBilling,
): Promise<ResultadoAvisoDePreco> {
  if (!precoMudou(mudanca.antes?.client, mudanca.depois?.client)) {
    return { ok: false, skipped: "client amount did not change" };
  }
  return entregarAoCliente(
    supabase,
    job,
    (publico) =>
      buildClientJobPriceChangedEmail({
        publico,
        jobReference: String(job.reference ?? ""),
        jobTitle: String(job.title ?? ""),
        propertyAddress: String(job.property_address ?? ""),
        oldAmount: num(mudanca.antes.client) ?? 0,
        newAmount: num(mudanca.depois.client) ?? 0,
        billing,
        hourly:
          billing === "hourly"
            ? {
                oldRate: num(mudanca.taxas?.antes?.client),
                newRate: num(mudanca.taxas?.depois?.client),
                hours: num(mudanca.taxas?.horas),
              }
            : null,
      }),
    "notify-price-change",
  );
}

async function avisarLadoDoParceiro(
  supabase: SupabaseClient,
  job: JobDoPreco,
  mudanca: MudancaDePreco,
  billing: PriceChangeBilling,
): Promise<ResultadoAvisoDePreco> {
  if (!precoMudou(mudanca.antes?.partner, mudanca.depois?.partner)) {
    return { ok: false, skipped: "partner amount did not change" };
  }
  return entregarAoParceiro(
    supabase,
    job,
    ({ primeiroNome, jobUrl }) =>
      buildPartnerJobPriceChangedEmail({
        partnerFirstName: primeiroNome,
        jobReference: String(job.reference ?? ""),
        jobTitle: job.title || "Maintenance job",
        propertyAddress: job.property_address || "",
        oldPay: num(mudanca.antes.partner) ?? 0,
        newPay: num(mudanca.depois.partner) ?? 0,
        billing,
        hourly:
          billing === "hourly"
            ? {
                oldRate: num(mudanca.taxas?.antes?.partner),
                newRate: num(mudanca.taxas?.depois?.partner),
                hours: num(mudanca.taxas?.horas),
              }
            : null,
        jobUrl,
      }),
    "notify-price-change",
  );
}
