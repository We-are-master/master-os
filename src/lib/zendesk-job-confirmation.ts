/**
 * Client booking confirmation email for Zendesk public comments.
 * Posted on the main ticket when a job is booked (status = scheduled).
 */

import { formatArrivalTimeRange, formatHourMinuteAmPm } from "@/lib/schedule-calendar";
import { extractUkPostcode } from "@/lib/uk-postcode";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  /** Rótulo e abertura próprios (visita extra, 19/10/2026). Sem eles, o "Job confirmed" de sempre. */
  eyebrow?: string;
  intro?: string;
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

/** A conta leva o nome da nossa empresa: é a dos clientes diretos, não uma organização. */
export function ehContaPropria(nomeDaConta: string | null | undefined, nomeDaEmpresa: string | null | undefined): boolean {
  const a = nomeDaConta?.trim().toLowerCase();
  const b = nomeDaEmpresa?.trim().toLowerCase();
  return Boolean(a && b && a === b);
}

/**
 * Nome da organização de uma conta, para a saudação.
 *
 * Existe para os avisos do ciclo de vida não repetirem esta consulta cada um do
 * seu jeito. Em 24/08/2026 o cancelamento do JOB-9491 saiu com "Hi Julian" — o
 * morador — numa nota pública cujo destinatário era hello@housekeep.com: o
 * aviso de criação já resolvia a organização, os terminais não.
 *
 * Nunca derruba o aviso: conta apagada ou consulta que falha devolve `null` e a
 * saudação cai no cliente, que é o comportamento antigo.
 */
export async function loadAccountOrganizationName(
  supabase: SupabaseClient,
  accountId: string | null | undefined,
): Promise<string | null> {
  const id = accountId?.trim();
  if (!id) return null;
  try {
    const { data, error } = await supabase
      .from("accounts")
      .select("company_name, contact_name")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      console.error("loadAccountOrganizationName:", error);
      return null;
    }
    const row = data as { company_name?: string | null; contact_name?: string | null } | null;
    const nome = row?.company_name?.trim() || row?.contact_name?.trim() || null;
    if (!nome) return null;
    // A conta com o nosso próprio nome é onde moram os clientes diretos. Sem isto o
    // cliente direto recebia "Hi Fixfy" (dono, 11/10/2026: "chama ela pelo nome").
    const { data: empresa } = await supabase.from("company_settings").select("company_name").limit(1).maybeSingle();
    if (ehContaPropria(nome, (empresa as { company_name?: string | null } | null)?.company_name)) return null;
    return nome;
  } catch (e) {
    console.error("loadAccountOrganizationName:", e);
    return null;
  }
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
 * A moldura dos avisos de job (confirmado e remarcado), no desenho de app.
 *
 * Dono, 20/10/2026: confirmação "like Uber", não e-mail de contador. No topo o
 * estado (✓ Confirmed / ↻ Rescheduled), um título grande e a data e a janela
 * em destaque; embaixo as linhas do job e uma frase para mudar alguma coisa.
 * Confirmação e remarcação usam a MESMA moldura: duas cópias do HTML é
 * garantir que o próximo ajuste entre em uma e esqueça a outra.
 *
 * O conteúdo é `div` e parágrafo, nunca tabela: o visualizador do Zendesk
 * desenha borda em toda célula, e este e-mail vai como comentário público no
 * ticket. A única tabela é a de fora, sem borda, para centralizar.
 */
function envelopeDaConta(args: { preheader: string; estado: string; corEstado: string; corpo: string }): string {
  const logo = escapeHtml(FIXFY_LOGO_URL);
  return compactHtml(`
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F5F5F7;">${escapeHtml(args.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:0;background:#F5F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td align="center" style="border:0;padding:24px 16px;">
<div style="width:100%;max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden;text-align:left;">

<div style="background:#020040;padding:18px 28px;">
<img src="${logo}" alt="Fixfy" width="72" height="31" style="display:block;width:72px;height:31px;border:0;">
</div>

<div style="padding:28px 28px 8px 28px;">
<p style="margin:0 0 6px 0;font-size:13px;font-weight:700;letter-spacing:1px;color:${args.corEstado};text-transform:uppercase;">${args.estado}</p>
${args.corpo}
</div>

<div style="padding:8px 28px 24px 28px;text-align:center;">
<p style="margin:0;font-size:14px;line-height:20px;color:#4A4A55;">Need to change something? Just reply to this email.</p>
</div>

<div style="padding:18px 28px 22px 28px;text-align:center;border-top:1px solid #EEEEF2;">
<p style="margin:0;font-size:11px;line-height:17px;color:#9A9CA8;">hello@getfixfy.com &middot; +44 20 4538 4668<br>Getfixfy Ltd &middot; 124 City Road, London EC1V 2NX &middot; <a href="https://getfixfy.com" style="color:#9A9CA8;text-decoration:none;">getfixfy.com</a></p>
</div>

</div>
</td></tr>
</table>
  `);
}

/** `9AM – 12PM` vira `9am to 12pm`: sem travessão e no mesmo jeito dos outros e-mails. */
export function janelaLegivel(janela: string | null | undefined): string {
  return String(janela ?? "")
    .trim()
    .replace(/\s*[–—-]\s*/g, " to ")
    .replace(/\b(\d{1,2}(?::\d{2})?)\s*(AM|PM)\b/gi, (_m, h: string, p: string) => `${h}${p.toLowerCase()}`);
}

/** Sem janela de chegada o texto não diz "between To be confirmed" (16/10/2026). */
function semJanela(janela: string | null | undefined): boolean {
  return !String(janela ?? "").trim() || /^to be confirmed$/i.test(String(janela).trim());
}

/** Data em destaque com a janela embaixo; sem janela, diz que ela vem depois. */
function blocoDaData(data: string, janela: string, riscado = false): string {
  const cor = riscado ? "#9A9AA8" : "#020040";
  const risco = riscado ? "text-decoration:line-through;" : "";
  const segunda = semJanela(janela) ? "Arrival time to be confirmed" : janelaLegivel(janela);
  return `<p style="margin:0;font-size:17px;line-height:24px;color:${riscado ? "#9A9AA8" : "#4A4A55"};${risco}">${escapeHtml(data)}<br><strong style="color:${cor};">${escapeHtml(segunda)}</strong></p>`;
}

/** As linhas do job, uma por parágrafo com rótulo à esquerda (sem tabela, ver a moldura). */
function linhasDoJob(linhas: Array<[string, string]>): string {
  return `<div style="margin:22px 0 8px 0;">${linhas
    .filter(([, v]) => v.trim())
    .map(
      ([rotulo, valor]) =>
        `<p style="margin:0;padding:12px 0;border-top:1px solid #EEEEF2;font-size:15px;line-height:22px;color:#020040;font-weight:600;"><span style="display:inline-block;min-width:84px;font-size:13px;font-weight:400;color:#6B6E7B;">${escapeHtml(rotulo)}</span>${valor}</p>`,
    )
    .join("")}</div>`;
}

export function buildJobConfirmationHtml(args: JobConfirmationEmailArgs): string {
  const greeting = escapeHtml(args.greetingName || "there");
  const endereco = [args.propertyAddress, args.propertyPostcode].map((s) => s?.trim()).filter(Boolean).join(", ");

  return envelopeDaConta({
    preheader: semJanela(args.arrivalWindow)
      ? `Your job is confirmed for ${args.jobDate}. We'll confirm the arrival time.`
      : `Your job is confirmed for ${args.jobDate}, ${janelaLegivel(args.arrivalWindow)}.`,
    estado: "&#10003; Confirmed",
    corEstado: "#16A34A",
    corpo: `<h1 style="margin:0 0 10px 0;font-size:28px;line-height:34px;font-weight:800;color:#020040;">You're booked, ${greeting}.</h1>
${blocoDaData(args.jobDate, args.arrivalWindow)}
${linhasDoJob([
  ["Service", escapeHtml(args.jobTitle || args.typeOfWork)],
  ["Where", escapeHtml(endereco)],
  ["Booking", escapeHtml(args.jobReference)],
])}`,
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
 * A data nova em destaque e a antiga riscada embaixo. Mostrar só a nova
 * obriga quem lê a lembrar qual era a anterior para entender o que mudou, e
 * quem recebe um aviso de remarcação costuma estar prestes a ligar para o
 * cliente dele.
 *
 * A conta é quem mais perde com o silêncio aqui: ela prometeu uma data ao
 * morador. Se muda e ela não sabe, quem descobre é o cliente dela, e a
 * reclamação volta para nós (JOB-9466, 20/08/2026).
 */
export function buildJobRescheduledHtml(args: JobRescheduledEmailArgs): string {
  const greeting = escapeHtml(args.greetingName || "there");
  const endereco = [args.propertyAddress, args.propertyPostcode].map((s) => s?.trim()).filter(Boolean).join(", ");
  const antes = [args.previousDate, args.previousArrivalWindow ? janelaLegivel(args.previousArrivalWindow) : ""]
    .filter(Boolean)
    .join(", ");

  return envelopeDaConta({
    preheader: semJanela(args.arrivalWindow)
      ? `This job moved to ${args.jobDate}. We'll confirm the arrival time.`
      : `This job moved to ${args.jobDate}, ${janelaLegivel(args.arrivalWindow)}.`,
    estado: "&#8635; Rescheduled",
    corEstado: "#ED4B00",
    corpo: `<h1 style="margin:0 0 10px 0;font-size:28px;line-height:34px;font-weight:800;color:#020040;">New date, ${greeting}.</h1>
${blocoDaData(args.jobDate, args.arrivalWindow)}
<p style="margin:8px 0 0 0;font-size:14px;line-height:20px;color:#9A9AA8;">Was <span style="text-decoration:line-through;">${escapeHtml(antes)}</span></p>
${linhasDoJob([
  ["Service", escapeHtml(args.jobTitle || args.typeOfWork)],
  ["Where", escapeHtml(endereco)],
  ["Booking", escapeHtml(args.jobReference)],
])}`,
  });
}
