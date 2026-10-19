/**
 * Aviso de remarcação para o CLIENTE.
 *
 * O par deste email para o parceiro já existia (`buildJobRescheduledEmail`, no
 * layout de parceiro). Faltava a outra metade: quando o escritório movia a
 * data, o parceiro sabia e o cliente descobria no dia, esperando alguém que
 * não ia mais. Este arquivo é a metade que faltava, no layout de cliente.
 *
 * As duas datas aparecem lado a lado, a antiga riscada. Mostrar só a nova
 * obriga o cliente a lembrar qual era a antiga para entender o que mudou, e
 * quem está sendo remarcado costuma estar irritado antes de abrir o email.
 */
import { escapeHtml } from "./client-email-layout";

export type ClientRescheduleData = {
  clientFirstName: string;
  jobReference: string;
  jobTitle: string;
  propertyAddress: string;
  /** "Thursday 21 August" */
  oldDateLine: string;
  /** "09:00 to 12:00", quando existir */
  oldTimeLine?: string | null;
  newDateLine: string;
  newTimeLine?: string | null;
  /** Motivo, quando o escritório quis dar um. Nunca inventado. */
  reason?: string | null;
};

export function buildClientJobRescheduledEmail(data: ClientRescheduleData): {
  subject: string;
  html: string;
  text: string;
} {
  const s = {
    name: data.clientFirstName?.trim() || "there",
    ref: escapeHtml(data.jobReference),
    title: escapeHtml(data.jobTitle || "your booking"),
    address: escapeHtml(data.propertyAddress || ""),
    oldDate: escapeHtml(data.oldDateLine || ""),
    oldTime: data.oldTimeLine ? escapeHtml(data.oldTimeLine) : "",
    newDate: escapeHtml(data.newDateLine || ""),
    newTime: data.newTimeLine ? escapeHtml(data.newTimeLine) : "",
    reason: data.reason?.trim() ? escapeHtml(data.reason.trim()) : "",
  };

  const subject = `Your booking has moved to ${data.newDateLine}${data.newTimeLine ? `, ${data.newTimeLine}` : ""}`;

  /**
   * Mesmo desenho de app do "You're booked" (dono, 20/10/2026): estado no topo,
   * data nova grande, a antiga riscada, as linhas do job e uma frase para
   * trocar de novo.
   */
  const linha = (rotulo: string, valor: string) =>
    valor
      ? `<tr><td style="padding:12px 0; border-top:1px solid #EEEEF2; font-size:13px; color:#6B6E7B; width:84px; vertical-align:top;">${rotulo}</td>` +
        `<td style="padding:12px 0; border-top:1px solid #EEEEF2; font-size:15px; line-height:22px; color:#020040; font-weight:600;">${valor}</td></tr>`
      : "";
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><title></title></head>
<body style="margin:0; padding:0; background:#F5F5F7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none; max-height:0; overflow:hidden; font-size:1px; line-height:1px; color:#F5F5F7;">${s.ref} moved to ${s.newDate}${s.newTime ? `, ${s.newTime}` : ""}.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F5F7;"><tr><td align="center" style="padding:24px 16px;">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px; max-width:520px; background:#FFFFFF; border-radius:16px; overflow:hidden;">
      <tr><td bgcolor="#020040" style="background:#020040; padding:18px 32px;"><img src="https://www.getfixfy.com/brand/fixfy-primary-white.png" alt="Fixfy" width="72" style="display:block; width:72px; height:auto;"></td></tr>
      <tr><td style="padding:28px 32px 4px 32px;">
        <p style="margin:0 0 6px 0; font-size:13px; font-weight:700; letter-spacing:1px; color:#ED4B00; text-transform:uppercase;">&#8635; Rescheduled</p>
        <h1 style="margin:0; font-size:30px; line-height:36px; font-weight:800; color:#020040;">New date, ${escapeHtml(s.name)}.</h1>
        <p style="margin:10px 0 0 0; font-size:17px; line-height:24px; color:#4A4A55;">${s.newDate}${s.newTime ? `<br><strong style="color:#020040;">${s.newTime}</strong>` : ""}</p>
        <p style="margin:8px 0 0 0; font-size:14px; line-height:20px; color:#9A9AA8;">Was <span style="text-decoration:line-through;">${s.oldDate}${s.oldTime ? `, ${s.oldTime}` : ""}</span></p>
        <p style="margin:16px 0 0 0; font-size:15px; line-height:22px; color:#4A4A55;">We've had to move your booking, and we're sorry for the change of plan.${s.reason ? ` ${s.reason}` : ""}</p>
      </td></tr>
      <tr><td style="padding:16px 32px 8px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${linha("Service", s.title)}
          ${linha("Where", s.address)}
          ${linha("Booking", s.ref)}
        </table>
      </td></tr>
      <tr><td style="padding:12px 32px 24px 32px; text-align:center; font-size:14px; line-height:20px; color:#4A4A55;">New date doesn't work? Just reply to this email and we'll find one that does.</td></tr>
      <tr><td style="padding:18px 32px 22px 32px; text-align:center; border-top:1px solid #EEEEF2;">
        <p style="margin:0; font-size:11px; line-height:17px; color:#9A9CA8;">hello@getfixfy.com · +44 20 4538 4668<br>Getfixfy Ltd · 124 City Road, London EC1V 2NX · getfixfy.com</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const text = [
    `Hi ${data.clientFirstName?.trim() || "there"},`,
    "",
    "We've had to move your booking, and we're sorry for the change of plan.",
    "",
    `Was: ${data.oldDateLine}${data.oldTimeLine ? ` ${data.oldTimeLine}` : ""}`,
    `Now: ${data.newDateLine}${data.newTimeLine ? ` ${data.newTimeLine}` : ""}`,
    "",
    data.reason?.trim() ? `Why: ${data.reason.trim()}` : "",
    `${data.jobTitle || "Your booking"}${data.propertyAddress ? ` · ${data.propertyAddress}` : ""}`,
    `Reference ${data.jobReference}`,
    "",
    "If the new date doesn't work for you, just reply to this email and we'll find one that does.",
  ].filter((l) => l !== "").join("\n");

  return { subject, html, text };
}
