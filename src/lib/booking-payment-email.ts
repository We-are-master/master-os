/**
 * E-mail de cobrança na criação do job (dono, 13/10/2026).
 *
 * Não é fatura: é o último passo de uma reserva. O cliente acabou de fechar e
 * falta pagar para o horário ficar dele. Por isso o tom é de "almost there", o
 * serviço inteiro vem escrito no corpo e o botão diz o valor.
 * A fatura segue em PDF no anexo, para quem precisa do documento.
 */
import { FIXFY_CLIENT_BANK_DETAIL_ROWS } from "@/lib/fixfy-client-bank-details";
import { displayBillingReference } from "@/lib/billing-reference";

export type BookingPaymentEmailInput = {
  clientName: string;
  jobReference: string;
  invoiceReference: string;
  serviceTitle: string;
  /** Escopo combinado com o cliente, em texto corrido ou em linhas. */
  scope?: string | null;
  /** `Thursday 16 October`. */
  dayLabel?: string | null;
  /** `between 9am and 12pm`. */
  windowLabel?: string | null;
  address?: string | null;
  total: number;
  amountDueNow: number;
  /** 1..100. Abaixo de 100 é sinal. */
  percent: number;
  payLink: string | null;
};

const NAVY = "#020040";
const ORANGE = "#F34E04";
const MUTED = "#6B6B7B";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function money(n: number): string {
  return `£${(Number(n) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function firstName(full: string): string {
  const t = full.trim().split(/\s+/)[0] ?? "";
  return t && !/^(mr|mrs|ms|miss|dr)\.?$/i.test(t) ? t : "there";
}

/** Linhas do escopo. Corta o que passar de 8 linhas ou 700 caracteres, para o e-mail não virar contrato. */
export function scopeLines(scope: string | null | undefined): string[] {
  const raw = String(scope ?? "").trim();
  if (!raw) return [];
  const lines = raw
    .split(/\r?\n+/)
    .map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
  const out: string[] = [];
  let used = 0;
  for (const l of lines) {
    if (out.length >= 8 || used + l.length > 700) break;
    out.push(l);
    used += l.length;
  }
  return out;
}

export function buildBookingPaymentSubject(i: Pick<BookingPaymentEmailInput, "clientName" | "dayLabel">): string {
  const name = firstName(i.clientName);
  const who = name === "there" ? "Almost there" : `Almost there, ${name}`;
  return i.dayLabel ? `${who}: confirm your booking for ${i.dayLabel}` : `${who}: one step left to confirm your booking`;
}

export function buildBookingPaymentEmailHTML(i: BookingPaymentEmailInput): string {
  const isDeposit = i.percent < 100 && i.amountDueNow < i.total - 0.005;
  const balance = Math.max(0, Math.round((i.total - i.amountDueNow) * 100) / 100);
  const name = firstName(i.clientName);
  const invoiceRef = displayBillingReference(i.invoiceReference);
  const when = [i.dayLabel, i.windowLabel ? `arriving ${i.windowLabel}` : null].filter(Boolean).join(", ");
  const lines = scopeLines(i.scope);
  const preheader = isDeposit
    ? `Pay your ${money(i.amountDueNow)} deposit and your slot is confirmed.`
    : `Pay ${money(i.amountDueNow)} and your slot is confirmed.`;
  const intro = isDeposit
    ? `We have your booking ready. One step left: pay the <strong>${money(i.amountDueNow)} deposit</strong> and your slot is confirmed. The rest is only due once the work is done.`
    : `We have your booking ready. One step left: pay <strong>${money(i.amountDueNow)}</strong> and your slot is confirmed.`;

  const row = (label: string, value: string) => `
                <tr>
                  <td valign="top" width="110" style="padding:7px 0; font-size:11px; font-weight:700; letter-spacing:1px; color:#9A9AA8; text-transform:uppercase;">${esc(label)}</td>
                  <td valign="top" style="padding:7px 0; font-size:14px; line-height:20px; color:${NAVY};">${value}</td>
                </tr>`;
  const scopeHtml = lines.length > 1
    ? lines.map((l) => `<div style="padding:0 0 4px 0;">&bull;&nbsp;${esc(l)}</div>`).join("")
    : lines.length === 1 ? esc(lines[0]) : "";
  const details = [
    row("Service", `<strong>${esc(i.serviceTitle)}</strong>`),
    scopeHtml ? row("Included", scopeHtml) : "",
    when ? row("When", esc(when.charAt(0).toUpperCase() + when.slice(1))) : "",
    i.address?.trim() ? row("Where", esc(i.address.trim())) : "",
    row("Booking", esc(i.jobReference)),
  ].join("");

  const priceRow = (label: string, value: string, strong = false) => `
                <tr>
                  <td style="padding:6px 0; font-size:${strong ? 15 : 13}px; color:${strong ? NAVY : MUTED}; font-weight:${strong ? 700 : 400};">${esc(label)}</td>
                  <td align="right" style="padding:6px 0; font-size:${strong ? 18 : 13}px; color:${strong ? NAVY : MUTED}; font-weight:${strong ? 700 : 400};">${esc(value)}</td>
                </tr>`;
  const prices = isDeposit
    ? priceRow("Total for the job", money(i.total)) + priceRow(`Deposit to confirm (${Math.round(i.percent)}%)`, money(i.amountDueNow), true) + priceRow("Balance, after the work is done", money(balance))
    : priceRow("To pay now", money(i.amountDueNow), true);

  const button = i.payLink
    ? `
          <tr>
            <td class="px" align="center" style="padding:4px 40px 8px 40px;">
              <a href="${esc(i.payLink)}" style="display:inline-block; background:${ORANGE}; color:#FFFFFF; text-decoration:none; font-size:16px; font-weight:700; padding:16px 36px; border-radius:10px;">Confirm and pay ${esc(money(i.amountDueNow))}</a>
              <p style="margin:10px 0 0 0; font-size:12px; color:#9A9AA8;">Card, Apple Pay or Google Pay. Secure payment by Stripe.</p>
            </td>
          </tr>`
    : "";

  const bankRows = FIXFY_CLIENT_BANK_DETAIL_ROWS.map((r) => `
                      <tr>
                        <td style="padding-top:4px; font-size:11px; font-weight:700; letter-spacing:1px; color:#9A9AA8; text-transform:uppercase;">${esc(r.label)}</td>
                        <td align="right" style="padding-top:4px; font-size:13px; color:${NAVY}; font-family:monospace;">${esc(r.value)}</td>
                      </tr>`).join("");

  const step = (n: number, title: string, text: string) => `
                <tr>
                  <td valign="top" width="34" style="padding:8px 0;"><div style="width:24px; height:24px; border-radius:12px; background:${n === 1 ? ORANGE : "#E8E8EE"}; color:${n === 1 ? "#FFFFFF" : NAVY}; font-size:12px; font-weight:700; line-height:24px; text-align:center;">${n}</div></td>
                  <td valign="top" style="padding:8px 0; font-size:13px; line-height:19px; color:${MUTED};"><strong style="color:${NAVY};">${esc(title)}</strong><br>${esc(text)}</td>
                </tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light only">
  <title>Confirm your booking</title>
  <style>
    body { margin:0 !important; padding:0 !important; width:100% !important; background:#F5F5F7; }
    @media screen and (max-width:600px) { .container { width:100% !important; } .px { padding-left:20px !important; padding-right:20px !important; } .h1 { font-size:24px !important; line-height:30px !important; } }
  </style>
</head>
<body style="margin:0; padding:0; background:#F5F5F7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none; max-height:0; overflow:hidden; font-size:1px; line-height:1px; color:#F5F5F7;">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F5F7;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px; background:#FFFFFF; border-radius:12px; overflow:hidden;">
          <tr>
            <td class="px" style="background:${NAVY}; padding:22px 40px;">
              <img src="https://www.getfixfy.com/brand/fixfy-primary-white.png" alt="Fixfy" width="96" style="display:block; width:96px; height:auto; border:0;">
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:34px 40px 6px 40px;">
              <p style="margin:0 0 10px 0; font-size:12px; font-weight:700; letter-spacing:2px; color:${ORANGE}; text-transform:uppercase;">One step left</p>
              <h1 class="h1" style="margin:0 0 14px 0; font-size:28px; line-height:34px; color:${NAVY}; font-weight:700;">Almost there, ${esc(name)}</h1>
              <p style="margin:0; font-size:15px; line-height:23px; color:${MUTED};">${intro}</p>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:22px 40px 8px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E8E8EE; border-radius:10px;"><tr><td style="padding:12px 20px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${details}
                </table>
              </td></tr></table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:12px 40px 18px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${prices}
              </table>
            </td>
          </tr>${button}
          <tr>
            <td class="px" style="padding:22px 40px 8px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F7FA; border-radius:8px;"><tr><td style="padding:14px 18px;">
                <p style="margin:0 0 8px 0; font-size:10px; font-weight:700; letter-spacing:2px; color:#9A9AA8; text-transform:uppercase;">Prefer a bank transfer?</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${bankRows}
                      <tr>
                        <td style="padding-top:4px; font-size:11px; font-weight:700; letter-spacing:1px; color:#9A9AA8; text-transform:uppercase;">Reference</td>
                        <td align="right" style="padding-top:4px; font-size:13px; color:${NAVY}; font-family:monospace;">${esc(invoiceRef)}</td>
                      </tr>
                </table>
                <p style="margin:10px 0 0 0; font-size:11px; line-height:16px; color:#9A9AA8;">Send ${esc(money(i.amountDueNow))} with the reference above and reply to this email once it is done, so we can confirm you straight away.</p>
              </td></tr></table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:20px 40px 6px 40px;">
              <p style="margin:0 0 4px 0; font-size:10px; font-weight:700; letter-spacing:2px; color:#9A9AA8; text-transform:uppercase;">What happens next</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${step(1, isDeposit ? "Pay the deposit" : "Pay to confirm", "It takes less than a minute and your slot is locked in.")}${step(2, "We confirm your professional", "You get their details before the visit.")}${step(3, isDeposit ? "The work is done, then the balance" : "The work is done", isDeposit ? `The remaining ${money(balance)} is only due after the job is completed.` : "We check everything was completed as agreed.")}
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:16px 40px 34px 40px;">
              <p style="margin:0; font-size:13px; line-height:20px; color:${MUTED};">Anything to change or a question first? Just reply to this email and we will sort it. Your invoice ${esc(invoiceRef)} is attached for your records.</p>
              <p style="margin:14px 0 0 0; font-size:13px; line-height:20px; color:${NAVY}; font-weight:600;">The Fixfy Team</p>
            </td>
          </tr>
    </table>
    <p style="margin:16px 0 0 0; font-size:11px; color:#9A9AA8;">GetFixfy LTD · London</p>
  </td></tr></table>
</body>
</html>`;
}
