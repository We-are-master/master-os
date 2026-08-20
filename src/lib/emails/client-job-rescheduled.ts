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
import {
  CLIENT_BRAND,
  escapeHtml,
  clientP,
  clientCallout,
  renderClientEmail,
} from "./client-email-layout";

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

/** As duas datas, a velha riscada e a nova em destaque. */
function blocoDeDatas(d: {
  oldDate: string; oldTime: string; newDate: string; newTime: string;
}): string {
  const linha = (rotulo: string, data: string, hora: string, riscado: boolean) => `
    <td width="50%" valign="top" style="padding:14px 16px;">
      <p style="margin:0 0 6px; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:${CLIENT_BRAND.gray};">${rotulo}</p>
      <p style="margin:0; font-size:16px; line-height:22px; font-weight:600; color:${riscado ? CLIENT_BRAND.gray : CLIENT_BRAND.ink}; ${riscado ? "text-decoration:line-through;" : ""}">${data}</p>
      ${hora ? `<p style="margin:4px 0 0; font-size:14px; line-height:20px; color:${riscado ? CLIENT_BRAND.gray : CLIENT_BRAND.body}; ${riscado ? "text-decoration:line-through;" : ""}">${hora}</p>` : ""}
    </td>`;

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="border-collapse:separate; border:1px solid ${CLIENT_BRAND.line}; border-radius:10px; margin:0 0 20px;">
    <tr>
      ${linha("Was", d.oldDate, d.oldTime, true)}
      ${linha("Now", d.newDate, d.newTime, false)}
    </tr>
  </table>`;
}

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
    oldDate: escapeHtml(data.oldDateLine || "—"),
    oldTime: data.oldTimeLine ? escapeHtml(data.oldTimeLine) : "",
    newDate: escapeHtml(data.newDateLine || "—"),
    newTime: data.newTimeLine ? escapeHtml(data.newTimeLine) : "",
    reason: data.reason?.trim() ? escapeHtml(data.reason.trim()) : "",
  };

  const subject = `Your booking has moved to ${data.newDateLine}${data.newTimeLine ? `, ${data.newTimeLine}` : ""}`;

  const corpo = [
    clientP("We've had to move your booking, and we're sorry for the change of plan."),
    blocoDeDatas(s),
    // O motivo só entra quando existe. Frase genérica de desculpa no lugar de
    // um motivo real é pior que silêncio: soa a script e não informa nada.
    s.reason ? clientP(`<strong>Why:</strong> ${s.reason}`) : "",
    clientCallout("Your booking", [
      `${s.title}`,
      s.address ? `${s.address}` : "",
      `Reference ${s.ref}`,
    ].filter(Boolean)),
    clientP(
      "If the new date doesn't work for you, just reply to this email and we'll find one that does.",
    ),
  ].join("\n");

  const html = renderClientEmail({
    preheader: `${s.ref} moved to ${s.newDate}${s.newTime ? ` at ${s.newTime}` : ""}.`,
    heading: "Your booking has been rescheduled",
    name: s.name,
    bodyHtml: corpo,
    footerNote: "You're receiving this because you have a booking with us.",
  });

  const text = [
    `Hi ${data.clientFirstName?.trim() || "there"},`,
    "",
    "We've had to move your booking, and we're sorry for the change of plan.",
    "",
    `Was: ${data.oldDateLine}${data.oldTimeLine ? ` ${data.oldTimeLine}` : ""}`,
    `Now: ${data.newDateLine}${data.newTimeLine ? ` ${data.newTimeLine}` : ""}`,
    "",
    data.reason?.trim() ? `Why: ${data.reason.trim()}` : "",
    `${data.jobTitle || "Your booking"}${data.propertyAddress ? ` — ${data.propertyAddress}` : ""}`,
    `Reference ${data.jobReference}`,
    "",
    "If the new date doesn't work for you, just reply to this email and we'll find one that does.",
  ].filter((l) => l !== "").join("\n");

  return { subject, html, text };
}
