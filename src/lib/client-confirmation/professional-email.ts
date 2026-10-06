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

/** Assunto, HTML e texto do C2, a partir de dados já resolvidos. Puro. */
export function buildProfessionalConfirmedEmail(i: ConfirmedEmailInput): { subject: string; html: string; text: string } {
  const pro = i.professionalName;
  const subject = `Booking confirmed with ${pro}: ${i.summary} on ${i.dateLabel} (${i.ref})`;
  const preheader = `${pro} arrives ${i.windowLabel} on ${i.dateLabel}. Everything you need for the day is inside.`;
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

  const p = (html: string, style = "margin:0 0 10px 0; font-size:14px; line-height:22px; color:#4A4A55;") =>
    `<p style="${style}">${html}</p>`;
  const sectionLabel = (t: string) =>
    `<p style="margin:0 0 10px 0; font-size:11px; font-weight:700; letter-spacing:2px; color:#020040; text-transform:uppercase;">${esc(t)}</p>`;
  const row = (label: string, value: string, bold = false) =>
    `<tr><td style="padding:8px 0; font-size:14px; color:#1A1A1A; ${bold ? "font-weight:700;" : ""}">${esc(label)}</td>` +
    `<td align="right" style="padding:8px 0; font-size:14px; color:#020040; font-weight:${bold ? 700 : 600}; white-space:nowrap;">${esc(value)}</td></tr>`;

  const bookingRows = [
    ...i.lines.map((l) => row(l.label, gbp(l.amount))),
    ...(i.amountPaid > 0.02 ? [row(`Paid to GETFIXFY LTD (Fixfy), as agent for ${pro}`, gbp(i.amountPaid), true)] : []),
  ].join("");
  const bookingNotes = [
    i.balance > 0.02 ? `The other ${gbp(i.balance)} is due when the work is done, through Fixfy.` : "",
    i.attachmentKind ? `Your ${i.attachmentKind} is attached, issued in ${pro}'s name.` : "",
  ]
    .filter(Boolean)
    .map((t) => p(esc(t), "margin:8px 0 0 0; font-size:13px; line-height:20px; color:#4A4A55;"))
    .join("");

  const card = (inner: string) =>
    `<tr><td style="padding:0 40px 20px 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E8E8EE; border-radius:8px;"><tr><td style="padding:16px 20px;">${inner}</td></tr></table></td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(subject)}</title></head>
<body style="margin:0; padding:0; background:#F5F5F7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none; max-height:0; overflow:hidden; font-size:1px; line-height:1px; color:#F5F5F7;">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F5F7;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background:#FFFFFF; border-radius:12px; overflow:hidden;">
      <tr><td align="center" bgcolor="#020040" style="background:#020040; padding:24px;"><img src="https://www.getfixfy.com/brand/fixfy-primary-white.png" alt="Fixfy" width="100" style="display:block; width:100px; height:auto;"></td></tr>
      <tr><td style="background:#ED4B00; line-height:5px; font-size:5px; height:5px;" height="5">&nbsp;</td></tr>
      <tr><td style="padding:32px 40px 8px 40px;"><h1 style="margin:0; font-size:26px; line-height:32px; font-weight:700; color:#020040;">Job Confirmed.</h1></td></tr>
      <tr><td style="padding:0 40px 24px 40px;">${p(
        `Thanks, ${esc(i.firstName)}. Your ${esc(i.summary)} with ${esc(pro)} is set for <strong>${esc(i.dateLabel)}</strong>. Everything you need for the day is below.`,
        "margin:0; font-size:15px; line-height:24px; color:#4A4A55;",
      )}</td></tr>
      ${card(
        sectionLabel("Your professional") +
          `<p style="margin:0 0 6px 0; font-size:16px; font-weight:700; color:#020040;">${esc(pro)}</p>` +
          p("Independent trader: they offer their services as a business, and your contract for this job is with them.") +
          (i.professionalAddress ? p(`Business address: ${esc(i.professionalAddress)}`) : "") +
          p(`VAT: ${esc(vatText)}`) +
          p("Insured: public liability insurance of at least £1 million") +
          p("To reach them, reply to this email or message us on WhatsApp, and we pass it on.", "margin:0; font-size:14px; line-height:22px; color:#4A4A55;"),
      )}
      ${card(
        sectionLabel("Your booking") +
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${bookingRows}</table>` +
          bookingNotes,
      )}
      ${card(
        p(`<strong>When:</strong> ${esc(i.dateLabel)}, arriving ${esc(i.windowLabel)}`) +
          (i.addressLine ? p(`<strong>Where:</strong> ${esc(i.addressLine)}`, "margin:0; font-size:14px; line-height:22px; color:#4A4A55;") : ""),
      )}
      ${
        i.calendarUrl
          ? `<tr><td align="center" style="padding:0 40px 24px 40px;"><a href="${esc(i.calendarUrl)}" style="display:inline-block; background:#020040; color:#FFFFFF; text-decoration:none; font-size:14px; font-weight:600; padding:12px 24px; border-radius:8px;">Add to Google Calendar</a></td></tr>`
          : ""
      }
      ${card(
        sectionLabel("What happens next") +
          p(`1. <strong>The day before.</strong> We call or message you to confirm ${esc(pro)}, the time and how they get in.`) +
          p(`2. <strong>${esc(i.dateLabel)}.</strong> ${esc(pro)} arrives ${esc(i.windowLabel)} and photographs every room as they finish.`) +
          p("3. <strong>Same day.</strong> Your photo report lands in your inbox, with a photo of every room they worked on.", "margin:0; font-size:14px; line-height:22px; color:#4A4A55;"),
      )}
      ${card(p(`<strong>${esc(guarantee.title)}</strong> ${esc(guarantee.body)}`, "margin:0; font-size:14px; line-height:22px; color:#4A4A55;"))}
      ${card(
        sectionLabel("Need to change something?") +
          p(
            `Just reply to this email and it reaches our team, who handle it for ${esc(pro)}. Changes and cancellation are free up to 48 hours before your slot, refunded in full.`,
            "margin:0; font-size:14px; line-height:22px; color:#4A4A55;",
          ),
      )}
      <tr><td style="padding:0 40px 28px 40px;">${p(
        `<strong>Who you are booking with.</strong> Your contract for this job is with ${esc(pro)}, an independent trader. GETFIXFY LTD (Fixfy) arranged the booking as their agent and received your payment on their behalf, so paying Fixfy counts as paying them. Your rights under the Consumer Rights Act 2015 are against ${esc(pro)} as the trader, and we will help you resolve any problem. Your booking is under our <a href="https://getfixfy.com/terms" style="color:#020040;">booking terms</a> (version of 6 October 2026), which also explain your legal right to cancel within 14 days and how to use it. You asked for the work to be done on the day you picked, so once it is done it can no longer be cancelled.`,
        "margin:0; font-size:12px; line-height:18px; color:#6B6E7B;",
      )}</td></tr>
      <tr><td bgcolor="#020040" style="background:#020040; padding:24px 40px; text-align:center;">
        <p style="margin:0; font-size:11px; line-height:18px; color:#AAAAD0;">Fixfy · Bookings with vetted independent professionals across London<br>GETFIXFY LTD, trading as Fixfy · 124 City Road, London EC1V 2NX · Company number 15406523<br><a href="https://getfixfy.com/terms" style="color:#AAAAD0;">Terms</a> · <a href="https://getfixfy.com/privacy" style="color:#AAAAD0;">Privacy</a> · <a href="https://getfixfy.com/guarantee" style="color:#AAAAD0;">Guarantee</a></p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const text = [
    `Job Confirmed. See you on ${i.dateLabel}.`,
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
  const balance = Math.max(0, Math.round((price - amountPaid) * 100) / 100);
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
