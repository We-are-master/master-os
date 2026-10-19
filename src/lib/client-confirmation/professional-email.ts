/**
 * "Booking confirmed with {professional}": o e-mail C2 do 04-booking-copy.
 *
 * No modelo de agente (Schedule A) o contrato do cliente é com o profissional e
 * começa quando ele é confirmado. Este e-mail é o que nomeia o profissional ao
 * cliente: quem é, endereço comercial, VAT, o que foi pago à Fixfy como agente
 * dele, o dia e a garantia. O recibo no nome do profissional vai anexo quando o
 * job já tem pagamento registrado.
 *
 * Portões, na ordem (todos precisam passar):
 *   1. `FIXFY_AGENT_MODEL=on` e `CLIENT_MESSAGING_ENABLED=1` (trava mestra de
 *      mensagem automática ao cliente). Desligado: não toca no banco.
 *   2. Job com parceiro, Schedule A, cliente com e-mail, dia e janela.
 *   3. Trava de envio único: update atômico em
 *      `jobs.client_professional_email_sent_at` ainda nulo (migration 313).
 *      Sem a coluna o e-mail NÃO sai: sem trava, cada chamador mandaria de novo.
 *
 * Troca de profissional depois do envio (e-mail C3) ainda é manual.
 * TODO(agent-model): C3 "Your professional has changed" quando
 * `client_professional_email_partner_id` diferir do parceiro do job.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { agentModelEnabled, resolveJobWorkSchedule } from "@/lib/agent-model/schedule";
import { receiptPartyFromPartner } from "@/lib/agent-model/receipt-party";
import { loadJobPromotionAmount } from "@/lib/agent-model/promotion";
import { invoiceCollectedAmount } from "@/lib/invoice-balance";
import type { Invoice } from "@/types/database";
import { mensagensAoClienteLigadas } from "./policy";

const REMETENTE_PADRAO = "Fixfy Team <no-reply@getfixfy.com>";
const RESPONDER_PARA = "hello@getfixfy.com";

export type ResultadoEmailProfissional =
  | { estado: "enviado"; email: string; id?: string }
  | { estado: "pulado"; motivo: string }
  | { estado: "falhou"; motivo: string };

export type ConfirmedEmailInput = {
  firstName: string;
  ref: string;
  summary: string;
  dateLabel: string;
  windowLabel: string;
  addressLine: string | null;
  professionalName: string;
  professionalAddress: string | null;
  professionalVatNumber: string | null;
  lines: { label: string; amount: number }[];
  /** Promoção da Fixfy paga em nome do cliente (0 = sem promoção). */
  promotion?: number;
  amountPaid: number;
  balance: number;
  /** O que vai anexo, no nome do profissional: recibo (pago) ou extrato (sinal). Nulo = nada. */
  attachmentKind: "receipt" | "statement" | null;
  isEndOfTenancy: boolean;
  calendarUrl: string | null;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function gbp(n: number): string {
  return `£${(Number(n) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** `2026-10-08` → `Thursday 8 October`. */
export function rotuloDoDia(ymd: string | null | undefined): string | null {
  const t = String(ymd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const [y, m, d] = t.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(dt);
}

/** `between 9am and 12pm`, em Londres. Null sem as duas pontas. */
export function rotuloDaJanela(inicio: string | null | undefined, fim: string | null | undefined): string | null {
  if (!inicio || !fim) return null;
  const h = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      hourCycle: "h12",
      timeZone: "Europe/London",
    }).formatToParts(d);
    const hour = parts.find((p) => p.type === "hour")?.value ?? "";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    const period = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toLowerCase().replace(/\./g, "");
    return `${hour}${minute === "00" ? "" : `:${minute}`}${period}`;
  };
  const a = h(inicio);
  const b = h(fim);
  return a && b ? `between ${a} and ${b}` : null;
}

function googleCalendarUrl(input: {
  title: string;
  startIso: string | null | undefined;
  endIso: string | null | undefined;
  details: string;
  location: string | null;
}): string | null {
  const fmt = (iso: string | null | undefined) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  };
  const a = fmt(input.startIso);
  const b = fmt(input.endIso);
  if (!a || !b) return null;
  const q = new URLSearchParams({ action: "TEMPLATE", text: input.title, dates: `${a}/${b}`, details: input.details });
  if (input.location) q.set("location", input.location);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/**
 * Assunto, HTML e texto do C2, a partir de dados já resolvidos. Puro.
 *
 * Desenho de confirmação de app (dono, 20/10/2026: "quero um job like Uber de
 * confirmação, não com tudo isso parecendo e-mail de contador"): no topo só o
 * que o cliente precisa no dia (quem vem, quando, onde, quanto) e um botão. O
 * que o modelo de agente obriga a dizer (contrato com o profissional, VAT,
 * endereço comercial, pagamento à Fixfy como agente) continua no e-mail, mas
 * em letra pequena no fim, como o recibo de um app.
 */
export function buildProfessionalConfirmedEmail(i: ConfirmedEmailInput): { subject: string; html: string; text: string } {
  const pro = i.professionalName;
  /** `between 9am and 12pm` vira `9am to 12pm` para o bloco grande. */
  const janelaCurta = i.windowLabel.replace(/^between\s+/i, "").replace(/\s+and\s+/i, " to ");
  const subject = `You're booked: ${pro}, ${i.dateLabel}, ${janelaCurta}`;
  const preheader = `${pro} arrives ${i.windowLabel} on ${i.dateLabel}. Booking ${i.ref}.`;
  const vatText = i.professionalVatNumber
    ? `VAT registered, VAT number ${i.professionalVatNumber}`
    : "Not VAT registered, so no VAT is charged";
  const guarantee = i.isEndOfTenancy
    ? {
        title: "Free re-clean within 7 days.",
        body: `If your letting agent or landlord flags anything on our checklist, reply with their note and we arrange for ${pro} to come back at no cost.`,
      }
    : {
        title: "7-day guarantee.",
        body: `If anything is not right, reply within 7 days of the job and we arrange for ${pro} to come back at no cost.`,
      };
  const iniciais =
    pro
      .split(/\s+/)
      .filter((w) => /^[A-Za-z0-9]/.test(w))
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "F";

  const total = i.lines.reduce((t, l) => t + (Number(l.amount) || 0), 0) - (i.promotion ?? 0);
  const pagamento =
    i.balance > 0.02 && i.amountPaid > 0.02
      ? `${gbp(i.amountPaid)} paid · ${gbp(i.balance)} after the job`
      : i.amountPaid > 0.02
        ? `${gbp(i.amountPaid)} paid`
        : `${gbp(total)} after the job`;

  const fino = "margin:0 0 8px 0; font-size:12px; line-height:18px; color:#6B6E7B;";
  const linha = (rotulo: string, valor: string) =>
    `<tr><td style="padding:14px 0; border-top:1px solid #EEEEF2; font-size:13px; color:#6B6E7B; width:90px; vertical-align:top;">${esc(rotulo)}</td>` +
    `<td style="padding:14px 0; border-top:1px solid #EEEEF2; font-size:15px; line-height:22px; color:#020040; font-weight:600;">${valor}</td></tr>`;
  const passo = (n: string, titulo: string, corpo: string) =>
    `<tr><td style="padding:0 12px 14px 0; vertical-align:top; width:28px;"><div style="width:24px; height:24px; line-height:24px; border-radius:12px; background:#F1F1F5; color:#020040; font-size:12px; font-weight:700; text-align:center;">${n}</div></td>` +
    `<td style="padding:0 0 14px 0; font-size:14px; line-height:20px; color:#4A4A55;"><strong style="color:#020040;">${esc(titulo)}</strong><br>${esc(corpo)}</td></tr>`;

  const linhasDoValor = [
    ...i.lines.map((l) => `${esc(l.label)}: ${gbp(l.amount)}`),
    ...((i.promotion ?? 0) > 0.02 ? [`Fixfy promotion, paid by Fixfy on your behalf: -${gbp(i.promotion ?? 0)}`] : []),
    ...(i.amountPaid > 0.02 ? [`Paid to GETFIXFY LTD (Fixfy), as agent for ${esc(pro)}: ${gbp(i.amountPaid)}`] : []),
    ...(i.balance > 0.02 ? [`The other ${gbp(i.balance)} is due when the work is done, through Fixfy.`] : []),
    ...(i.attachmentKind ? [`Your ${i.attachmentKind} is attached, issued in ${esc(pro)}'s name.`] : []),
  ];

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(subject)}</title></head>
<body style="margin:0; padding:0; background:#F5F5F7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none; max-height:0; overflow:hidden; font-size:1px; line-height:1px; color:#F5F5F7;">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F5F7;"><tr><td align="center" style="padding:24px 16px;">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px; max-width:520px; background:#FFFFFF; border-radius:16px; overflow:hidden;">
      <tr><td bgcolor="#020040" style="background:#020040; padding:18px 32px;"><img src="https://www.getfixfy.com/brand/fixfy-primary-white.png" alt="Fixfy" width="72" style="display:block; width:72px; height:auto;"></td></tr>
      <tr><td style="padding:28px 32px 4px 32px;">
        <p style="margin:0 0 6px 0; font-size:13px; font-weight:700; letter-spacing:1px; color:#16A34A; text-transform:uppercase;">&#10003; Confirmed</p>
        <h1 style="margin:0; font-size:30px; line-height:36px; font-weight:800; color:#020040;">You're booked, ${esc(i.firstName)}.</h1>
        <p style="margin:10px 0 0 0; font-size:17px; line-height:24px; color:#4A4A55;">${esc(i.dateLabel)}<br><strong style="color:#020040;">${esc(janelaCurta)}</strong></p>
      </td></tr>
      <tr><td style="padding:24px 32px 8px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F7FA; border-radius:12px;"><tr>
          <td style="padding:16px 0 16px 16px; width:52px; vertical-align:middle;"><div style="width:48px; height:48px; line-height:48px; border-radius:24px; background:#020040; color:#FFFFFF; font-size:17px; font-weight:700; text-align:center;">${esc(iniciais)}</div></td>
          <td style="padding:16px; vertical-align:middle;">
            <p style="margin:0; font-size:17px; font-weight:700; color:#020040;">${esc(pro)}</p>
            <p style="margin:3px 0 0 0; font-size:13px; line-height:18px; color:#6B6E7B;">Your professional · Vetted · Insured to £1m</p>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:8px 32px 8px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${linha("Service", esc(i.summary))}
          ${i.addressLine ? linha("Where", esc(i.addressLine)) : ""}
          ${linha("Payment", esc(pagamento))}
          ${linha("Booking", esc(i.ref))}
        </table>
      </td></tr>
      ${
        i.calendarUrl
          ? `<tr><td style="padding:16px 32px 4px 32px;"><a href="${esc(i.calendarUrl)}" style="display:block; background:#ED4B00; color:#FFFFFF; text-decoration:none; font-size:16px; font-weight:700; padding:15px 0; border-radius:10px; text-align:center;">Add to calendar</a></td></tr>`
          : ""
      }
      <tr><td style="padding:10px 32px 24px 32px; text-align:center; font-size:14px; line-height:20px; color:#4A4A55;">Need to change something? Just reply to this email.<br>Free to change or cancel up to 48 hours before.</td></tr>
      <tr><td style="padding:0 32px;"><div style="border-top:1px solid #EEEEF2; line-height:1px; font-size:1px;">&nbsp;</div></td></tr>
      <tr><td style="padding:24px 32px 10px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${passo("1", "The day before", `We message you to confirm ${pro} and how they get in.`)}
          ${passo("2", "On the day", `${pro} arrives ${janelaCurta} and photographs the work as they finish.`)}
          ${passo("3", "Same day", "Your photo report lands in your inbox.")}
        </table>
      </td></tr>
      <tr><td style="padding:0 32px 24px 32px;"><p style="margin:0; padding:14px 16px; background:#F0FDF4; border-radius:10px; font-size:14px; line-height:20px; color:#14532D;"><strong>${esc(guarantee.title)}</strong> ${esc(guarantee.body)}</p></td></tr>
      <tr><td style="padding:20px 32px 24px 32px; background:#FAFAFB; border-top:1px solid #EEEEF2;">
        <p style="margin:0 0 8px 0; font-size:12px; font-weight:700; color:#4A4A55;">Booking details</p>
        ${linhasDoValor.map((t) => `<p style="${fino}">${t}</p>`).join("")}
        <p style="${fino}">${esc(pro)} is an independent trader${i.professionalAddress ? `, business address ${esc(i.professionalAddress)}` : ""}. VAT: ${esc(vatText)}.</p>
        <p style="margin:0; font-size:12px; line-height:18px; color:#6B6E7B;">Your contract for this job is with ${esc(pro)}. GETFIXFY LTD (Fixfy) arranged the booking as their agent and received your payment on their behalf, so paying Fixfy counts as paying them. Your rights under the Consumer Rights Act 2015 are against ${esc(pro)} as the trader, and we will help you resolve any problem. Your booking is under our <a href="https://getfixfy.com/terms" style="color:#6B6E7B;">booking terms</a> (version of 6 October 2026), which also explain your legal right to cancel within 14 days. You asked for the work to be done on the day you picked, so once it is done it can no longer be cancelled.</p>
      </td></tr>
      <tr><td style="padding:18px 32px 22px 32px; text-align:center;">
        <p style="margin:0; font-size:11px; line-height:17px; color:#9A9CA8;">hello@getfixfy.com · +44 20 4538 4668<br>GETFIXFY LTD, trading as Fixfy · 124 City Road, London EC1V 2NX · Company number 15406523<br><a href="https://getfixfy.com/terms" style="color:#9A9CA8;">Terms</a> · <a href="https://getfixfy.com/privacy" style="color:#9A9CA8;">Privacy</a> · <a href="https://getfixfy.com/guarantee" style="color:#9A9CA8;">Guarantee</a></p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const text = [
    `You're booked. See you on ${i.dateLabel}.`,
    "",
    `Hi ${i.firstName},`,
    `Your booking ${i.ref} with ${pro} is confirmed.`,
    "",
    "YOUR PROFESSIONAL",
    `${pro}, independent trader. Your contract for this job is with them.`,
    ...(i.professionalAddress ? [`Business address: ${i.professionalAddress}`] : []),
    `VAT: ${vatText}`,
    "Public liability insurance of at least £1 million.",
    "To reach them, reply to this email and we pass it on.",
    "",
    "YOUR BOOKING",
    ...i.lines.map((l) => `${l.label}: ${gbp(l.amount)}`),
    ...((i.promotion ?? 0) > 0.02 ? [`Fixfy promotion, paid by Fixfy on your behalf: -${gbp(i.promotion ?? 0)}`] : []),
    ...(i.amountPaid > 0.02 ? [`Paid to GETFIXFY LTD (Fixfy), as agent for ${pro}: ${gbp(i.amountPaid)}`] : []),
    ...(i.balance > 0.02 ? [`Balance after the job, through Fixfy: ${gbp(i.balance)}`] : []),
    ...(i.attachmentKind ? [`Your ${i.attachmentKind}, in ${pro}'s name, is attached.`] : []),
    "",
    `When: ${i.dateLabel}, arriving ${i.windowLabel}`,
    ...(i.addressLine ? [`Where: ${i.addressLine}`] : []),
    "",
    "What happens next",
    `1. The day before: we call or message you to confirm ${pro}, the time and how they get in.`,
    `2. ${i.dateLabel}: ${pro} arrives ${i.windowLabel} and photographs every room as they finish.`,
    "3. Same day: your photo report lands in your inbox.",
    "",
    `${guarantee.title} ${guarantee.body}`,
    ...(i.calendarUrl ? ["", `Add to Google Calendar: ${i.calendarUrl}`] : []),
    "",
    "Need to change something? Just reply to this email. Changes and cancellation are free up to 48 hours before your slot, refunded in full.",
    "",
    `Who you are booking with: your contract for this job is with ${pro}, an independent trader. GETFIXFY LTD (Fixfy) arranged the booking as their agent and received your payment on their behalf. Your rights under the Consumer Rights Act 2015 are against ${pro}, and we will help you resolve any problem.`,
    "Booking terms (version of 6 October 2026), including your legal right to cancel within 14 days: getfixfy.com/terms",
    "You asked for the work to be done on the day you picked, so once it is done it can no longer be cancelled.",
    "",
    "GETFIXFY LTD, trading as Fixfy · 124 City Road, London EC1V 2NX · Company number 15406523",
  ].join("\n");

  return { subject, html, text };
}

export type EnvioDeEmail = (msg: {
  from: string;
  to: string[];
  replyTo: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}) => Promise<{ id?: string }>;

async function enviarPeloResend(msg: Parameters<EnvioDeEmail>[0]): Promise<{ id?: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error("RESEND_API_KEY not configured");
  const { data, error } = await new Resend(key).emails.send(msg);
  if (error) throw new Error(typeof error === "object" && "message" in error ? String(error.message) : "send failed");
  return { id: data?.id };
}

const JOB_SELECT =
  "id, reference, title, partner_id, client_id, client_name, created_at, property_address, scheduled_date, " +
  "scheduled_start_at, scheduled_end_at, client_price, extras_amount, invoice_id, client_professional_email_sent_at";

export async function enviarEmailConfirmadoComProfissional(
  supabase: SupabaseClient,
  jobId: string,
  opcoes?: { enviar?: EnvioDeEmail; simular?: boolean },
): Promise<ResultadoEmailProfissional> {
  // Portões de ambiente antes de qualquer leitura: desligado não toca no banco.
  if (!agentModelEnabled()) return { estado: "pulado", motivo: "agent model is off (FIXFY_AGENT_MODEL)" };
  if (!mensagensAoClienteLigadas() && !opcoes?.simular) {
    return { estado: "pulado", motivo: "client messaging is off (CLIENT_MESSAGING_ENABLED)" };
  }

  const { data: jobRow, error: jobErr } = await supabase.from("jobs").select(JOB_SELECT).eq("id", jobId).maybeSingle();
  if (jobErr) {
    // Coluna da 313 ausente cai aqui: sem trava de envio único, não se manda.
    return { estado: "pulado", motivo: `job read failed (migration 313 applied?): ${jobErr.message}` };
  }
  if (!jobRow) return { estado: "falhou", motivo: "job not found" };
  const j = jobRow as unknown as Record<string, unknown>;
  if (j.client_professional_email_sent_at) return { estado: "pulado", motivo: "already sent" };
  const partnerId = typeof j.partner_id === "string" ? j.partner_id : "";
  if (!partnerId) return { estado: "pulado", motivo: "no partner assigned yet" };

  const schedule = await resolveJobWorkSchedule(supabase, {
    id: jobId,
    client_id: (j.client_id as string | null) ?? null,
    created_at: (j.created_at as string | null) ?? null,
  });
  if (schedule !== "A") return { estado: "pulado", motivo: "Schedule B job (business account): no agent confirmation" };

  const { data: cliente } = await supabase
    .from("clients")
    .select("full_name, email")
    .eq("id", String(j.client_id))
    .maybeSingle();
  const email = String((cliente as { email?: string | null } | null)?.email ?? "").trim();
  if (!email.includes("@")) return { estado: "pulado", motivo: "customer has no email" };

  const { data: parceiro } = await supabase
    .from("partners")
    .select("company_name, contact_name, partner_address, vat_number, vat_registered")
    .eq("id", partnerId)
    .maybeSingle();
  const party = receiptPartyFromPartner(parceiro as Parameters<typeof receiptPartyFromPartner>[0]);
  if (!party.professionalName) return { estado: "pulado", motivo: "partner has no name on file" };

  const dateLabel = rotuloDoDia((j.scheduled_date as string) ?? (j.scheduled_start_at as string));
  const windowLabel = rotuloDaJanela(j.scheduled_start_at as string, j.scheduled_end_at as string);
  if (!dateLabel || !windowLabel) {
    return { estado: "pulado", motivo: !dateLabel ? "job has no scheduled date" : "job has no arrival window" };
  }

  // O que já foi pago (à Fixfy, como agente) vem da invoice do job.
  let amountPaid = 0;
  const invoiceId = typeof j.invoice_id === "string" ? j.invoice_id : null;
  if (invoiceId) {
    const { data: inv } = await supabase
      .from("invoices")
      .select("status, amount, amount_paid")
      .eq("id", invoiceId)
      .maybeSingle();
    if (inv) amountPaid = invoiceCollectedAmount(inv as Pick<Invoice, "status" | "amount" | "amount_paid">);
  }

  const title = String(j.title ?? "").trim() || "Your booking";
  const base = Math.round((Number(j.client_price) || 0) * 100) / 100;
  const extras = Math.round((Number(j.extras_amount) || 0) * 100) / 100;
  const lines = [
    ...(base > 0.02 ? [{ label: title, amount: base }] : []),
    ...(extras > 0.02 ? [{ label: "Extras", amount: extras }] : []),
  ];
  const price = lines.reduce((s, l) => s + l.amount, 0);
  // A promoção da Fixfy nunca é cobrada do cliente (mig 313).
  const promotion = Math.min(price, await loadJobPromotionAmount(supabase, jobId));
  const balance = Math.max(0, Math.round((price - promotion - amountPaid) * 100) / 100);
  const firstName = String((cliente as { full_name?: string | null } | null)?.full_name ?? j.client_name ?? "")
    .trim()
    .split(/\s+/)[0] || "there";
  const ref = String(j.reference ?? "");
  const addressLine = (j.property_address as string | null)?.trim() || null;

  if (opcoes?.simular) {
    return { estado: "pulado", motivo: `dry run: would email ${email} confirmed with ${party.professionalName}` };
  }

  // Trava de envio único: só quem vira a coluna de nula para preenchida manda.
  const agora = new Date().toISOString();
  const { data: claimed, error: claimErr } = await supabase
    .from("jobs")
    .update({ client_professional_email_sent_at: agora, client_professional_email_partner_id: partnerId })
    .eq("id", jobId)
    .is("client_professional_email_sent_at", null)
    .select("id");
  if (claimErr) return { estado: "pulado", motivo: `could not claim send (migration 313 applied?): ${claimErr.message}` };
  if (!claimed || (claimed as unknown[]).length === 0) return { estado: "pulado", motivo: "already sent" };

  // Recibo no nome do profissional, quando já existe pagamento registrado.
  let attachments: { filename: string; content: Buffer; contentType: string }[] | undefined;
  if (invoiceId && amountPaid > 0.02) {
    try {
      const { renderInvoicePdfBuffer } = await import("@/lib/invoice-send-email");
      const pdf = await renderInvoicePdfBuffer(supabase, invoiceId);
      if (!("error" in pdf)) {
        attachments = [
          { filename: `${pdf.reference.replace(/[^\w.-]+/g, "_")}-receipt.pdf`, content: pdf.buffer, contentType: "application/pdf" },
        ];
      }
    } catch (e) {
      console.warn("[confirmacao-email] receipt render failed, sending without it:", e);
    }
  }

  const msg = buildProfessionalConfirmedEmail({
    firstName,
    ref,
    summary: title,
    dateLabel,
    windowLabel,
    addressLine,
    professionalName: party.professionalName,
    professionalAddress: party.businessAddress,
    professionalVatNumber: party.vatNumber,
    lines,
    promotion,
    amountPaid,
    balance: amountPaid > 0.02 ? balance : 0,
    attachmentKind: attachments?.length ? (balance > 0.02 ? "statement" : "receipt") : null,
    isEndOfTenancy: /end of tenancy/i.test(title),
    calendarUrl: googleCalendarUrl({
      title: `${title} with ${party.professionalName}`,
      startIso: j.scheduled_start_at as string,
      endIso: j.scheduled_end_at as string,
      details: `Booking ${ref} with ${party.professionalName}. They arrive ${windowLabel}. To change anything, reply to your confirmation email.`,
      location: addressLine,
    }),
  });

  try {
    const enviar = opcoes?.enviar ?? enviarPeloResend;
    const { id } = await enviar({
      from: process.env.CLIENT_CONFIRMATION_FROM?.trim() || REMETENTE_PADRAO,
      to: [email],
      replyTo: RESPONDER_PARA,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      attachments,
    });
    console.log(`[confirmacao-email] ${jobId} enviado para ${email} (${id ?? "sem id"})`);
    return { estado: "enviado", email, id };
  } catch (err) {
    // Devolve a trava: a próxima chamada tenta de novo.
    await supabase
      .from("jobs")
      .update({ client_professional_email_sent_at: null, client_professional_email_partner_id: null })
      .eq("id", jobId);
    const motivo = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    console.error(`[confirmacao-email] ${jobId} falhou: ${motivo}`);
    return { estado: "falhou", motivo };
  }
}
