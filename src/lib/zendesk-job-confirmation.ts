/**
 * Client booking confirmation email for Zendesk public comments.
 * Posted on the main ticket when a job is booked (status = scheduled).
 */

import { formatArrivalTimeRange, formatHourMinuteAmPm } from "@/lib/schedule-calendar";
import { extractUkPostcode } from "@/lib/uk-postcode";

const FIXFY_LOGO_URL = "https://www.getfixfy.com/brand/fixfy-primary-white.png";

export interface JobConfirmationEmailArgs {
  /** Organization name when linked; otherwise client first name. */
  greetingName: string;
  jobReference: string;
  jobTitle: string;
  jobDate: string;
  arrivalWindow: string;
  propertyAddress: string;
  propertyPostcode: string;
  typeOfWork: string;
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstName(full: string): string {
  return (full.trim().split(/\s+/)[0] ?? "").trim();
}

/** Organization name wins; otherwise the client's first name. */
export function resolveCustomerGreetingName(
  organizationName: string | null | undefined,
  clientDisplayName: string,
): string {
  const org = organizationName?.trim();
  if (org) return org;
  return firstName(clientDisplayName) || "there";
}

/** Format YYYY-MM-DD as "11 Jun" — same short date as partner job email subjects. */
export function formatJobConfirmationLongDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map((n) => Number(n));
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(dt);
}

export function formatJobConfirmationArrivalWindow(args: {
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
}): string {
  if (args.scheduled_start_at && args.scheduled_end_at) {
    return formatArrivalTimeRange(args.scheduled_start_at, args.scheduled_end_at) ?? "To be confirmed";
  }
  if (args.scheduled_start_at) {
    const dt = new Date(args.scheduled_start_at);
    if (!Number.isNaN(dt.getTime())) return formatHourMinuteAmPm(dt);
  }
  return "To be confirmed";
}

export function splitPropertyAddressAndPostcode(full: string): {
  propertyAddress: string;
  propertyPostcode: string;
} {
  const raw = full.trim();
  const postcode = extractUkPostcode(raw);
  if (!postcode) return { propertyAddress: raw || "—", propertyPostcode: "" };
  const address = raw
    .replace(new RegExp(postcode.replace(/\s+/g, "\\s*"), "i"), "")
    .replace(/,\s*$/, "")
    .trim();
  return {
    propertyAddress: address || raw,
    propertyPostcode: postcode,
  };
}

function compactHtml(html: string): string {
  return html.replace(/>\s+</g, "><").trim();
}

/**
 * O casco do email da conta: cabeçalho, faixa laranja, corpo e rodapé.
 *
 * Existe para os dois avisos usarem a MESMA moldura. Confirmação e remarcação
 * são o mesmo email com um rótulo e um miolo diferentes; deixar duas cópias do
 * HTML é garantir que o próximo ajuste entre em uma e esqueça a outra.
 *
 * Hero e rodapé têm a mesma altura, 64px, e chegam lá pelo PADDING, nunca por
 * `height` fixo: altura fixa com conteúdo inline transborda, e o
 * `overflow:hidden` do cartão corta o que passou.
 *
 * O conteúdo é parágrafo, não tabela. O visualizador do Zendesk desenha borda
 * em toda célula, então uma grade aqui vira dez linhas cortando o email na
 * tela de quem lê pelo painel.
 */
function envelopeDaConta(args: { preheader: string; eyebrow: string; corpo: string }): string {
  const logo = escapeHtml(FIXFY_LOGO_URL);
  return compactHtml(`
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F7F7FB;">${escapeHtml(args.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:0;background:#F7F7FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td align="center" style="border:0;padding:32px 16px;">
<div style="width:100%;max-width:600px;margin:0 auto;background:#FFFFFF;border-radius:12px;overflow:hidden;text-align:left;">

<div style="background:#020040;padding:16px 24px;">
<img src="${logo}" alt="Fixfy" width="74" height="32" style="display:block;margin:0 auto;width:74px;height:32px;border:0;">
</div>
<div style="background:#ED4B00;height:4px;line-height:4px;font-size:4px;">&nbsp;</div>

<div style="padding:22px 24px 20px 24px;">
<p style="margin:0 0 10px 0;font-size:10px;font-weight:700;letter-spacing:2.5px;color:#ED4B00;text-transform:uppercase;">${args.eyebrow}</p>
${args.corpo}
<p style="margin:20px 0 0 0;font-size:13px;line-height:20px;color:#4A4A55;">Need to change it, or have a question? Reply to this email or write to <a href="mailto:support@getfixfy.com" style="color:#020040;font-weight:600;text-decoration:none;">support@getfixfy.com</a>.</p>
</div>

<div style="background:#020040;padding:24px;text-align:center;">
<p style="margin:0;font-size:11px;line-height:16px;color:#AAAAD0;">Getfixfy Ltd &middot; 124 City Road, London EC1V 2NX &middot; <a href="https://getfixfy.com" style="color:#AAAAD0;text-decoration:none;">getfixfy.com</a></p>
</div>

</div>
</td></tr>
</table>
  `);
}

/** Bloco de identificação do job: referência, título, e o serviço embaixo. */
function blocoDoJob(ref: string, title: string): string {
  return `<p style="margin:0 0 2px 0;font-size:11px;color:#9A9AA8;">#${ref}</p>
<p style="margin:0 0 16px 0;font-size:19px;font-weight:700;line-height:24px;color:#020040;">${title}</p>`;
}

export function buildJobConfirmationHtml(args: JobConfirmationEmailArgs): string {
  const greeting = escapeHtml(args.greetingName || "there");
  const ref = escapeHtml(args.jobReference);
  const title = escapeHtml(args.jobTitle);
  const date = escapeHtml(args.jobDate);
  const window = escapeHtml(args.arrivalWindow);
  const address = escapeHtml(args.propertyAddress);
  const postcode = escapeHtml(args.propertyPostcode);
  const service = escapeHtml(args.typeOfWork);

  const postcodeLine = postcode
    ? `<br><span style="color:#4A4A55;">${postcode}</span>`
    : "";

  return envelopeDaConta({
    preheader: `Your job is confirmed for ${args.jobDate} between ${args.arrivalWindow}.`,
    eyebrow: "&#10003; Job confirmed",
    corpo: `<p style="margin:0 0 18px 0;font-size:15px;line-height:22px;color:#4A4A55;">Hi <strong style="color:#020040;">${greeting}</strong>, this job is booked and scheduled.</p>
${blocoDoJob(ref, title)}
<p style="margin:0 0 6px 0;font-size:15px;line-height:22px;color:#020040;">
<strong style="font-weight:700;">${date}</strong><span style="color:#9A9AA8;"> &middot; </span><strong style="font-weight:700;">${window}</strong>
</p>
<p style="margin:0 0 4px 0;font-size:14px;line-height:20px;color:#1A1A1A;">${address}${postcodeLine}</p>
<p style="margin:0;font-size:13px;line-height:20px;color:#9A9AA8;">${service}</p>`,
  });
}

export interface JobRescheduledEmailArgs extends JobConfirmationEmailArgs {
  /** A data que estava marcada antes, para aparecer riscada ao lado da nova. */
  previousDate: string;
  previousArrivalWindow?: string;
}

/**
 * Aviso de REMARCAÇÃO para a conta, na mesma moldura do confirmado.
 *
 * As duas datas aparecem lado a lado, a antiga riscada. Mostrar só a nova
 * obriga quem lê a lembrar qual era a anterior para entender o que mudou, e
 * quem recebe um aviso de remarcação costuma estar prestes a ligar para o
 * cliente dele.
 *
 * A conta é quem mais perde com o silêncio aqui: ela prometeu uma data ao
 * morador. Se muda e ela não sabe, quem descobre é o cliente dela, e a
 * reclamação volta para nós — foi o JOB-9466 em 20/08/2026.
 */
export function buildJobRescheduledHtml(args: JobRescheduledEmailArgs): string {
  const greeting = escapeHtml(args.greetingName || "there");
  const ref = escapeHtml(args.jobReference);
  const title = escapeHtml(args.jobTitle);
  const date = escapeHtml(args.jobDate);
  const window = escapeHtml(args.arrivalWindow);
  const antes = escapeHtml(args.previousDate);
  const antesJanela = args.previousArrivalWindow ? escapeHtml(args.previousArrivalWindow) : "";
  const address = escapeHtml(args.propertyAddress);
  const postcode = escapeHtml(args.propertyPostcode);
  const service = escapeHtml(args.typeOfWork);
  const postcodeLine = postcode ? `<br><span style="color:#4A4A55;">${postcode}</span>` : "";

  return envelopeDaConta({
    preheader: `This job moved to ${args.jobDate} between ${args.arrivalWindow}.`,
    eyebrow: "&#8635; Job rescheduled",
    corpo: `<p style="margin:0 0 18px 0;font-size:15px;line-height:22px;color:#4A4A55;">Hi <strong style="color:#020040;">${greeting}</strong>, this job has moved to a new date.</p>
${blocoDoJob(ref, title)}
<p style="margin:0 0 4px 0;font-size:10px;font-weight:700;letter-spacing:1px;color:#9A9AA8;text-transform:uppercase;">Was</p>
<p style="margin:0 0 12px 0;font-size:15px;line-height:22px;color:#9A9AA8;text-decoration:line-through;">${antes}${antesJanela ? ` &middot; ${antesJanela}` : ""}</p>
<p style="margin:0 0 4px 0;font-size:10px;font-weight:700;letter-spacing:1px;color:#ED4B00;text-transform:uppercase;">Now</p>
<p style="margin:0 0 12px 0;font-size:15px;line-height:22px;color:#020040;">
<strong style="font-weight:700;">${date}</strong><span style="color:#9A9AA8;"> &middot; </span><strong style="font-weight:700;">${window}</strong>
</p>
<p style="margin:0 0 4px 0;font-size:14px;line-height:20px;color:#1A1A1A;">${address}${postcodeLine}</p>
<p style="margin:0;font-size:13px;line-height:20px;color:#9A9AA8;">${service}</p>`,
  });
}
