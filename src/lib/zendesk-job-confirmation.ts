/**
 * Client booking confirmation email for Zendesk public comments.
 * Posted on the main ticket when a job is booked (status = scheduled).
 *
 * Copy aprovada em 20/10/2026 (docs/copy/fixfy-client-copy.json, ids 1 e 5)
 * na moldura única de `@/lib/emails/fixfy-shell` (desenho de app).
 */

import { extractUkPostcode } from "@/lib/uk-postcode";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  dataLonga,
  emailFixfy,
  horaCurta,
  janelaDeTexto,
  janelaTexto,
  saudacao,
  type Publico,
} from "@/lib/emails/fixfy-shell";

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
  /**
   * Quem recebe, pela relação da conta (handoff: nunca pelo nome). Sem ele, vale
   * o que `resolveCustomerGreetingName` resolveu: nome de organização = B2B.
   */
  publico?: Publico;
}

function firstName(full: string): string {
  return (full.trim().split(/\s+/)[0] ?? "").trim();
}

/**
 * Nomes de organização que `resolveCustomerGreetingName` devolveu neste
 * processo. Os chamadores (ciclo de vida, visita extra) passam só a string
 * pronta para o builder; é por aqui que o builder sabe que ela veio da RELAÇÃO
 * com a conta (B2B: "Hi Housekeep team,") e não do nome do cliente. Quem puder,
 * passa `publico` explícito e isto nem é consultado.
 */
const nomesDeOrganizacao = new Set<string>();

/** Organization name wins; otherwise the client's first name. */
export function resolveCustomerGreetingName(
  organizationName: string | null | undefined,
  clientDisplayName: string,
): string {
  const org = organizationName?.trim();
  if (org) {
    if (nomesDeOrganizacao.size > 2000) nomesDeOrganizacao.clear();
    nomesDeOrganizacao.add(org);
    return org;
  }
  return firstName(clientDisplayName) || "there";
}

/** O público de um aviso: o explícito, ou o que a saudação resolvida indica. */
export function publicoDaSaudacao(greetingName: string | null | undefined, explicito?: Publico): Publico {
  if (explicito) return explicito;
  const nome = String(greetingName ?? "").trim();
  if (nome && nomesDeOrganizacao.has(nome)) return { tipo: "b2b", empresa: nome };
  return { tipo: "b2c", primeiroNome: nome && nome.toLowerCase() !== "there" ? nome : null };
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

/** YYYY-MM-DD como `Wednesday 21 October 2026` (copy de 20/10/2026, Europe/London). */
export function formatJobConfirmationLongDate(ymd: string): string {
  return dataLonga(String(ymd ?? "").slice(0, 10)) ?? ymd;
}

/** `between 9am and midday`, `from 9am` só com o início, senão `To be confirmed`. */
export function formatJobConfirmationArrivalWindow(args: {
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
}): string {
  if (args.scheduled_start_at && args.scheduled_end_at) {
    return janelaTexto(args.scheduled_start_at, args.scheduled_end_at) ?? "To be confirmed";
  }
  const so = horaCurta(args.scheduled_start_at);
  return so ? `from ${so}` : "To be confirmed";
}

export function splitPropertyAddressAndPostcode(full: string): {
  propertyAddress: string;
  propertyPostcode: string;
} {
  const raw = full.trim();
  const postcode = extractUkPostcode(raw);
  if (!postcode) return { propertyAddress: raw, propertyPostcode: "" };
  const address = raw
    .replace(new RegExp(postcode.replace(/\s+/g, "\\s*"), "i"), "")
    .replace(/,\s*$/, "")
    .trim();
  return {
    propertyAddress: address || raw,
    propertyPostcode: postcode,
  };
}



// ─── Datas e janelas que chegam como texto ──────────────────────────────

const SEM_DATA = /^(new date|previous date|previously scheduled|new schedule|to be confirmed)$/i;

/** Tira travessão de qualquer texto que vai ao cliente (copy: nada de — ou –). */
function semTravessao(t: string): string {
  return t.replace(/\s*[–—]\s*/g, " to ").replace(/\s+/g, " ").trim();
}

/**
 * Janela em texto livre (`9AM – 12PM`, `09:00-12:00`, `9 AM`, `between 9am and
 * midday`) no formato da copy: `between 9am and midday` ou `from 9am`. Null sem
 * janela ou "To be confirmed".
 */
export function janelaDoAviso(texto: string | null | undefined): string | null {
  const t = String(texto ?? "").trim();
  if (!t || /^to be confirmed$/i.test(t)) return null;
  if (/^(between|from)\s/i.test(t)) return semTravessao(t);
  const so = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (so) {
    let h = Number(so[1]);
    const ap = so[3]?.toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    const d = new Date(Date.UTC(2026, 0, 15, h, Number(so[2] ?? 0))); // janeiro: Londres = UTC
    const hc = horaCurta(d);
    return hc ? `from ${hc}` : t;
  }
  const j = janelaDeTexto(t);
  return j ? semTravessao(j) : null;
}

/** `9AM – 12PM` vira `between 9am and midday`: sem travessão e no jeito da copy. */
export function janelaLegivel(janela: string | null | undefined): string {
  return janelaDoAviso(janela) ?? "";
}

/**
 * Uma linha de agenda (`2026-10-21`, `21 Oct 2026 · Arrival time 9AM – 12PM`,
 * `Wednesday 21 October 2026`) e a hora separada, quando vier, em data e janela.
 */
export function lerLinhaDaAgenda(
  dataLinha: string | null | undefined,
  horaLinha?: string | null,
): { data: string | null; janela: string | null } {
  let d = String(dataLinha ?? "").trim();
  let h = String(horaLinha ?? "").trim();
  const partes = d.split(/\s*·\s*Arrival time\s*/i);
  if (partes.length > 1) {
    d = partes[0]!.trim();
    if (!h) h = partes.slice(1).join(" ").trim();
  }
  const data = !d || SEM_DATA.test(d) ? null : /^\d{4}-\d{2}-\d{2}/.test(d) ? dataLonga(d.slice(0, 10)) : semTravessao(d);
  return { data, janela: janelaDoAviso(h) };
}

const juntar = (...p: Array<string | null | undefined>) => p.map((x) => String(x ?? "").trim()).filter(Boolean).join(" · ");
const enderecoCompleto = (a: { propertyAddress?: string; propertyPostcode?: string }) =>
  [a.propertyAddress, a.propertyPostcode].map((s) => String(s ?? "").trim()).filter(Boolean).join(", ");

// ─── #1 Job confirmado (comentário público no ticket) ───────────────────

/**
 * Assunto proposto pela copy. O comentário no ticket mantém o assunto do fio
 * (handoff), então só vale para e-mail novo (conversa lateral, Resend).
 */
export function buildJobConfirmationSubject(args: Pick<JobConfirmationEmailArgs, "jobDate">): string {
  const data = lerLinhaDaAgenda(args.jobDate).data;
  return data ? `Your Fixfy booking is confirmed · ${data}` : "Your Fixfy booking is confirmed";
}

export function buildJobConfirmationEmail(args: JobConfirmationEmailArgs): { subject: string; html: string; text: string } {
  const { data, janela } = lerLinhaDaAgenda(args.jobDate, args.arrivalWindow);
  const servico = String(args.jobTitle || args.typeOfWork || "").trim();
  const endereco = enderecoCompleto(args);
  const publico = publicoDaSaudacao(args.greetingName, args.publico);

  const quando = data
    ? janela
      ? `Your professional is confirmed for ${data}, arriving ${janela}.`
      : `Your professional is confirmed for ${data}. We’ll confirm the arrival time before the visit.`
    : "Your professional is confirmed.";
  const intro = String(args.intro ?? "").trim();
  const paragrafos = [
    ...(intro ? [intro.charAt(0).toUpperCase() + intro.slice(1)] : []),
    `Lovely, that’s in the diary. ${quando}`,
    "You’ll find the booking details below. If there’s anything we should know about access or parking, just reply and we’ll make a note.",
    "We look forward to getting everything sorted for you.",
  ];
  const preheader = [servico && endereco ? `${servico} at ${endereco}.` : servico ? `${servico}.` : endereco ? `${endereco}.` : "", janela ? `Arrival ${janela}.` : ""]
    .filter(Boolean)
    .join(" ") || "Your booking is confirmed.";

  const { html, text } = emailFixfy({
    zendesk: true,
    preheader,
    estado: { texto: String(args.eyebrow ?? "").trim() || "Confirmed", cor: "green" },
    titulo: "Your booking is confirmed",
    destaque: data ? { linha1: data, linha2: janela ?? "Arrival time to be confirmed" } : null,
    saudacao: saudacao(publico),
    paragrafos,
    linhas: [
      ["Service", servico],
      ["Date", data],
      ["Arrival", janela],
      ["Property", endereco],
      ["Booking", args.jobReference],
    ],
  });
  return { subject: buildJobConfirmationSubject(args), html, text };
}

export function buildJobConfirmationHtml(args: JobConfirmationEmailArgs): string {
  return buildJobConfirmationEmail(args).html;
}

// ─── #5 Job remarcado, para a conta ─────────────────────────────────────

export interface JobRescheduledEmailArgs extends JobConfirmationEmailArgs {
  /** A data que estava marcada antes, para aparecer riscada ao lado da nova. */
  previousDate: string;
  previousArrivalWindow?: string;
  /** A Fixfy mudou a data (não o cliente): entra o pedido de desculpas. Sem saber, não entra. */
  iniciadoPelaFixfy?: boolean;
}

export function buildJobRescheduledSubject(args: Pick<JobRescheduledEmailArgs, "jobReference" | "jobDate">): string {
  const data = lerLinhaDaAgenda(args.jobDate).data;
  return ["Booking rescheduled", String(args.jobReference ?? "").trim(), data].filter(Boolean).join(" · ");
}

/**
 * Aviso de REMARCAÇÃO para a conta, na mesma moldura do confirmado.
 *
 * A data nova em destaque e a antiga riscada embaixo. A conta é quem mais perde
 * com o silêncio aqui: ela prometeu uma data ao morador (JOB-9466, 20/08/2026).
 */
export function buildJobRescheduledEmail(args: JobRescheduledEmailArgs): { subject: string; html: string; text: string } {
  const novo = lerLinhaDaAgenda(args.jobDate, args.arrivalWindow);
  const antes = lerLinhaDaAgenda(args.previousDate, args.previousArrivalWindow);
  const servico = String(args.jobTitle || args.typeOfWork || "").trim();
  const endereco = enderecoCompleto(args);
  const publico = publicoDaSaudacao(args.greetingName, args.publico);
  const ondeFrase = endereco ? `the booking at ${endereco}` : "this booking";

  const { html, text } = emailFixfy({
    zendesk: true,
    preheader: endereco
      ? `The revised date and arrival window for ${endereco} are below.`
      : "The revised date and arrival window are below.",
    estado: { texto: "Rescheduled", cor: "orange" },
    titulo: "Your revised booking details",
    destaque: novo.data
      ? { linha1: novo.data, linha2: novo.janela ?? "Arrival time to be confirmed", riscado: juntar(antes.data, antes.janela) || null }
      : null,
    saudacao: saudacao(publico),
    paragrafos: [
      `We’re writing to confirm a change to ${ondeFrase}. The previous and revised arrangements are below.${args.iniciadoPelaFixfy ? " We’re sorry for the disruption." : ""}`,
      "Please let us know if the new time affects access, key collection or arrangements with the occupier. We’ll help coordinate the next steps.",
    ],
    linhas: [
      ["Previous visit", juntar(antes.data, antes.janela)],
      ["Revised visit", juntar(novo.data, novo.janela)],
      ["Service", servico],
      ["Property", endereco],
      ["Booking", args.jobReference],
    ],
  });
  return { subject: buildJobRescheduledSubject(args), html, text };
}

export function buildJobRescheduledHtml(args: JobRescheduledEmailArgs): string {
  return buildJobRescheduledEmail(args).html;
}
