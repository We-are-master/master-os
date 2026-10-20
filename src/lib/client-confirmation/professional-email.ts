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
import { dataLonga, emailFixfy, gbp, janelaTexto, saudacao } from "@/lib/emails/fixfy-shell";

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

/** `2026-10-08` → `Thursday 8 October 2026` (copy de 20/10/2026, Europe/London). */
export function rotuloDoDia(ymd: string | null | undefined): string | null {
  const t = String(ymd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return dataLonga(t);
}

/** `between 9am and midday`, em Londres. Null sem as duas pontas. */
export function rotuloDaJanela(inicio: string | null | undefined, fim: string | null | undefined): string | null {
  if (!inicio || !fim) return null;
  return janelaTexto(inicio, fim);
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
 * Copy aprovada em 20/10/2026 (id 2) na moldura única de app: estado,
 * título, data e janela em destaque, as linhas do job. O que o modelo de
 * agente obriga a dizer (contrato com o profissional, VAT, endereço comercial,
 * pagamento à Fixfy como agente, Consumer Rights Act, versão dos termos, 14
 * dias) continua inteiro, na letra pequena do fim.
 */
export function buildProfessionalConfirmedEmail(i: ConfirmedEmailInput): { subject: string; html: string; text: string } {
  const pro = i.professionalName.trim();
  const subject = `Your ${pro} booking is confirmed · ${i.dateLabel}`;
  const preheader = i.addressLine
    ? `${i.summary} at ${i.addressLine}, arriving ${i.windowLabel}.`
    : `${i.summary}, arriving ${i.windowLabel}.`;
  const vatText = i.professionalVatNumber
    ? `VAT registered, VAT number ${i.professionalVatNumber}`
    : "Not VAT registered, so no VAT is charged";
  const guarantee = i.isEndOfTenancy
    ? `Free re-clean within 7 days. If your letting agent or landlord flags anything on our checklist, reply with their note and we arrange for ${pro} to come back at no cost.`
    : `7-day guarantee. If anything is not right, reply within 7 days of the job and we arrange for ${pro} to come back at no cost.`;

  const valores = [
    ...i.lines.map((l) => `${l.label}: ${gbp(l.amount)}`),
    ...((i.promotion ?? 0) > 0.02 ? [`Fixfy promotion, paid by Fixfy on your behalf: -${gbp(i.promotion ?? 0)}`] : []),
    ...(i.amountPaid > 0.02 ? [`Paid to GETFIXFY LTD (Fixfy), as agent for ${pro}: ${gbp(i.amountPaid)}`] : []),
    ...(i.balance > 0.02 ? [`The other ${gbp(i.balance)} is due when the work is done, through Fixfy.`] : []),
    ...(i.attachmentKind ? [`Your ${i.attachmentKind} is attached, issued in ${pro}'s name.`] : []),
  ];

  return {
    subject,
    ...emailFixfy({
      preheader,
      estado: { texto: "Confirmed", cor: "green" },
      titulo: "Your professional is confirmed",
      destaque: { linha1: i.dateLabel, linha2: i.windowLabel },
      saudacao: saudacao({ tipo: "b2c", primeiroNome: i.firstName === "there" ? null : i.firstName }),
      paragrafos: [
        `Your booking with ${pro} is confirmed. They’ll arrive on ${i.dateLabel}, ${i.windowLabel}, ready to carry out the work agreed.`,
        "We’ve included the details below so you have everything in one place.",
        "If you have a question before the visit, just reply. We’re happy to help.",
      ],
      linhas: [
        ["Professional", pro],
        ["Service", i.summary],
        ["Date", i.dateLabel],
        ["Arrival", i.windowLabel],
        ["Property", i.addressLine],
        ["Booking", i.ref],
      ],
      linksSecundarios: i.calendarUrl ? [{ label: "Add to calendar", url: i.calendarUrl }] : [],
      nota: guarantee,
      letraPequena: [
        ...valores,
        `${pro} is an independent trader${i.professionalAddress ? `, business address ${i.professionalAddress}` : ""}. VAT: ${vatText}.`,
        `Your contract for this job is with ${pro}. GETFIXFY LTD (Fixfy) arranged the booking as their agent and received your payment on their behalf, so paying Fixfy counts as paying them. Your rights under the Consumer Rights Act 2015 are against ${pro} as the trader, and we will help you resolve any problem.`,
        "Your booking is under our booking terms (version of 6 October 2026), getfixfy.com/terms, which also explain your legal right to cancel within 14 days. You asked for the work to be done on the day you picked, so once it is done it can no longer be cancelled.",
        "Changes and cancellation are free up to 48 hours before your slot.",
      ],
    }),
  };
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
    .split(/\s+/)[0] || "";
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
