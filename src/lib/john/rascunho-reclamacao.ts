/**
 * John, reclamações: só rascunho (dono, 10/11/2026).
 *
 * O John cuida das reclamações, mas por enquanto só ESCREVE: não responde ao cliente,
 * não responde ao parceiro, não admite culpa e não oferece reembolso nem desconto.
 * Job em on hold por reclamação ganha:
 *
 *   1. rascunho ao parceiro no journal da reclamação (job_complaint_messages, mig 333),
 *      como mensagem do escritório com visible_to_partner = false. O portal do parceiro
 *      só mostra mensagens do parceiro ou com visible_to_partner = true;
 *   2. rascunho ao cliente em nota INTERNA no ticket do job (public: false), com o
 *      Action Required ligado para a equipe revisar. Sem ticket, ticket fechado ou
 *      ticket com o Harvey: o rascunho ao cliente fica no journal, junto do outro.
 *
 * Uma vez por hold e mais uma quando o parceiro responde (formulário de on hold ou
 * mensagem dele no journal). A marca "[Draft by John, not sent]" no começo do texto é
 * o que torna a rotina idempotente, no journal e no ticket.
 *
 * Fatos só do job, do texto da reclamação e da resposta do parceiro. O modelo
 * (gpt-4o-mini) só reescreve o modelo pronto; se ele trouxer número novo, dinheiro,
 * culpa ou o nome do parceiro ao cliente, vale o modelo.
 *
 * Desligado sem JOHN_RASCUNHO=1: `rodarJohn` devolve sem ler nem escrever nada.
 * Quem roda: scripts/john-rascunho-reclamacao.mts, pelo fixfy-workers (rotinas.mts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { conferirMensagem } from "@/lib/harvey/conferente";
import { jobOnHoldPorReclamacao } from "@/lib/job-on-hold-reasons";
import { ACTION_REQUIRED_FIELD_ID, ACTION_REQUIRED_YES, notaDaAcao } from "@/lib/fila-de-acao";
import { isZendeskConfigured, zendeskApi } from "@/lib/zendesk";
import { chamarOpenAI } from "@/lib/openai-com-retry";
import { normalizarMobileUk } from "@/lib/client-confirmation/policy";

export const MARCA = "[Draft by John, not sent]";
export const MARCA_ATUALIZACAO = `${MARCA} Update after the partner's reply.`;
export const AUTOR = "John (draft)";
/** O pedido de evidência que o John MANDOU ao parceiro no 7983 (o parceiro vê no portal). */
export const MARCA_PEDIDO = "[John asked the partner for evidence on WhatsApp]";
/** O pedido não saiu (chave desligada, sem celular, uazapi recusou): o caso vai direto para a equipe. */
export const MARCA_PEDIDO_NAO_ENVIADO = "[John could not ask the partner on WhatsApp]";
/** Fecha o rascunho na nota do ticket: o que está entre a marca e esta linha é o que sai com a macro. */
export const FIM_DO_RASCUNHO = "[End of draft]";
/** A macro do Zendesk "John: send reply" põe esta tag; a passada envia e troca por TAG_ENVIADO. */
export const TAG_ENVIAR = "john_send";
export const TAG_ENVIADO = "john_sent";
/** Sem resposta do parceiro em tanto tempo, o caso vai para a equipe assim mesmo. */
export const ESPERA_DO_PARCEIRO_H = 24;
/** Hold mais velho que isso não ganha rascunho: ligar a flag não pode encher tickets antigos. */
export const JANELA_DIAS = 14;
/** Teto por passada. */
const MAXIMO_POR_PASSADA = 15;

export type Etapa = "inicial" | "depois-da-resposta";

type Oferta = { data: string; slot: "morning" | "afternoon" };
export type Submissao = {
  notes?: string | null;
  photos?: string[];
  available_dates?: string[];
  remedy?: "revisit" | "discount" | null;
  offers?: Oferta[];
  submitted_at?: string | null;
};

export type JobDaReclamacao = {
  id: string;
  reference: string;
  title: string | null;
  status: string;
  client_name: string | null;
  partner_id: string | null;
  partner_name: string | null;
  scheduled_date: string | null;
  external_source: string | null;
  external_ref: string | null;
  on_hold_at: string | null;
  on_hold_reason: string | null;
  on_hold_reason_preset_id: string | null;
  on_hold_complaint_description: string | null;
  on_hold_submission: Submissao | null;
  on_hold_submission_at: string | null;
};

export const CAMPOS_DO_JOB =
  "id, reference, title, status, client_name, partner_id, partner_name, scheduled_date, external_source, external_ref, on_hold_at, on_hold_reason, on_hold_reason_preset_id, on_hold_complaint_description, on_hold_submission, on_hold_submission_at";

export type LinhaDoJournal = {
  job_id: string;
  author: "partner" | "office";
  body: string | null;
  photos: string[] | null;
  created_at: string;
};

export function johnLigado(env: Record<string, string | undefined> = process.env): boolean {
  return env.JOHN_RASCUNHO?.trim() === "1";
}

/** Mandar de verdade o pedido de evidência ao parceiro no 7983. Sem ela, o pedido vira rascunho no journal. */
export function johnAvisaParceiro(env: Record<string, string | undefined> = process.env): boolean {
  return env.JOHN_AVISA_PARCEIRO?.trim() === "1";
}

/** O pedido ao parceiro deste hold: quando e se saiu. */
export function pedidoDoHold(job: JobDaReclamacao, linhas: LinhaDoJournal[]): { em: string; enviado: boolean } | null {
  const t0 = ms(job.on_hold_at);
  const p = linhas
    .filter((l) => l.job_id === job.id && l.author === "office" && ms(l.created_at) >= t0)
    .map((l) => ({ em: l.created_at, enviado: String(l.body ?? "").startsWith(MARCA_PEDIDO), nao: String(l.body ?? "").startsWith(MARCA_PEDIDO_NAO_ENVIADO) }))
    .filter((x) => x.enviado || x.nao)
    .sort((a, b) => ms(a.em) - ms(b.em))[0];
  return p ? { em: p.em, enviado: p.enviado } : null;
}

/** De qual etapa é este texto (journal ou nota do ticket). Null = não é rascunho do John. */
export function etapaDoRascunho(corpo: string | null | undefined): Etapa | null {
  const t = String(corpo ?? "");
  if (t.includes(MARCA_ATUALIZACAO)) return "depois-da-resposta";
  if (t.includes(MARCA)) return "inicial";
  return null;
}

// ─── Partes puras ───────────────────────────────────────────────────────────

const ms = (iso: string | null | undefined) => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : NaN;
};

export type RespostaDoParceiro = {
  em: string;
  fotos: number;
  ofertas: Oferta[];
  datas: string[];
  remedy: "revisit" | "discount" | null;
};

/** O parceiro respondeu NESTE hold? Formulário de on hold ou mensagem dele no journal. */
export function respostaDoParceiro(job: JobDaReclamacao, linhas: LinhaDoJournal[]): RespostaDoParceiro | null {
  const t0 = ms(job.on_hold_at);
  if (!Number.isFinite(t0)) return null;
  const doParceiro = linhas.filter((l) => l.job_id === job.id && l.author === "partner" && ms(l.created_at) >= t0);
  const s = job.on_hold_submission;
  const subEm = job.on_hold_submission_at ?? s?.submitted_at ?? null;
  const temSub =
    !!s && ms(subEm) >= t0 && !!(s.notes?.trim() || s.photos?.length || s.available_dates?.length || s.remedy);
  if (!temSub && !doParceiro.length) return null;
  const quando = [...doParceiro.map((l) => l.created_at), ...(temSub && subEm ? [subEm] : [])].sort((a, b) => ms(a) - ms(b));
  return {
    em: quando.at(-1)!,
    // Foto do 7983 fica na conversa do /inbox; no journal vira "(image sent on WhatsApp…)".
    fotos:
      (temSub ? s!.photos?.length ?? 0 : 0) +
      doParceiro.reduce((n, l) => n + (l.photos?.length ?? 0) + (/\((image|video|document) sent on WhatsApp/.test(String(l.body ?? "")) ? 1 : 0), 0),
    ofertas: temSub && Array.isArray(s!.offers) ? s!.offers! : [],
    datas: temSub && Array.isArray(s!.available_dates) ? s!.available_dates! : [],
    remedy: temSub ? s!.remedy ?? null : null,
  };
}

export type Passo = Etapa | "pedido" | "nada";

/**
 * O que o John faz neste job agora (dono, 12/11/2026):
 *   1. pedido: pede ao parceiro, no 7983, o que aconteceu, fotos e quando volta;
 *   2. inicial: o parceiro não respondeu em 24h (ou o pedido não saiu): o caso vai à equipe;
 *   3. depois-da-resposta: o parceiro respondeu: o caso, com a resposta, vai à equipe.
 * O rascunho ao cliente só nasce em 2 ou 3, nunca antes de ouvir o parceiro.
 */
export function passoDoJohn(job: JobDaReclamacao, linhas: LinhaDoJournal[], agora: Date = new Date()): Passo {
  if (job.status !== "on_hold" || !jobOnHoldPorReclamacao(job)) return "nada";
  const t0 = ms(job.on_hold_at);
  if (!Number.isFinite(t0) || agora.getTime() - t0 > JANELA_DIAS * 864e5) return "nada";
  const meus = linhas.filter((l) => l.job_id === job.id && l.author === "office" && ms(l.created_at) >= t0);
  const etapas = meus.map((l) => ({ etapa: etapaDoRascunho(l.body), em: ms(l.created_at) })).filter((x) => x.etapa);
  if (etapas.some((x) => x.etapa === "depois-da-resposta")) return "nada";
  const resposta = respostaDoParceiro(job, linhas);
  if (!etapas.length) {
    if (resposta) return "depois-da-resposta";
    if (!job.partner_id) return "inicial";
    const pedido = pedidoDoHold(job, linhas);
    if (!pedido) return "pedido";
    if (!pedido.enviado) return "inicial";
    return agora.getTime() - ms(pedido.em) >= ESPERA_DO_PARCEIRO_H * 36e5 ? "inicial" : "nada";
  }
  const ultimoRascunho = Math.max(...etapas.map((x) => x.em));
  return resposta && ms(resposta.em) > ultimoRascunho ? "depois-da-resposta" : "nada";
}

/** O texto da reclamação, sem o rótulo "Complaint" do começo e sem o "(raised in ticket #N)". */
export function textoDaReclamacao(job: JobDaReclamacao): string {
  const bruto = job.on_hold_complaint_description?.trim() || job.on_hold_reason?.trim() || "";
  return bruto
    .replace(/^complaint\s*[—–:-]\s*/i, "")
    .replace(/\s*\(raised in ticket #\d+\)\s*$/i, "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function primeiroNome(nome: string | null | undefined): string | null {
  const p = String(nome ?? "").trim().split(/\s+/)[0] ?? "";
  if (!/^[A-Za-zÀ-ÿ'-]{2,}$/.test(p)) return null;
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

const SLOT: Record<string, string> = { morning: "morning (8am to 1pm)", afternoon: "afternoon (1pm to 6pm)" };

function dia(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ymd
    : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });
}

function ou(itens: string[]): string {
  return itens.length <= 1 ? itens.join("") : `${itens.slice(0, -1).join(", ")} or ${itens.at(-1)}`;
}

/** As voltas que o parceiro ofereceu e ainda não passaram. */
export function voltasOferecidas(r: RespostaDoParceiro | null, agora: Date = new Date()): string[] {
  if (!r) return [];
  const hoje = agora.toISOString().slice(0, 10);
  if (r.ofertas.length) return r.ofertas.filter((o) => o.data >= hoje).map((o) => `${dia(o.data)}, ${SLOT[o.slot] ?? o.slot}`);
  return r.datas.filter((d) => d >= hoje).map(dia);
}

export type Fatos = {
  ref: string;
  servico: string;
  dataDoJob: string | null;
  reclamacao: string;
  cliente: string | null;
  parceiro: string | null;
  temParceiro: boolean;
  nomesDoParceiro: string[];
  resposta: RespostaDoParceiro | null;
  voltas: string[];
};

export function fatosDoJob(
  job: JobDaReclamacao,
  linhas: LinhaDoJournal[],
  contato: { contact_name?: string | null; company_name?: string | null } | null,
  agora: Date = new Date(),
): Fatos {
  const resposta = respostaDoParceiro(job, linhas);
  return {
    ref: job.reference,
    servico: job.title?.trim() || "the job",
    dataDoJob: job.scheduled_date ? dia(job.scheduled_date) : null,
    reclamacao: textoDaReclamacao(job),
    cliente: primeiroNome(job.client_name),
    parceiro: primeiroNome(contato?.contact_name),
    temParceiro: !!job.partner_id,
    nomesDoParceiro: [job.partner_name, contato?.company_name, contato?.contact_name].filter((n): n is string => !!n?.trim()),
    resposta,
    voltas: voltasOferecidas(resposta, agora),
  };
}

const ASSINATURA = "Thanks,\nFixfy Team";

export function rascunhoParaParceiro(f: Fatos, etapa: Etapa): string {
  const oi = `Hi ${f.parceiro ?? "there"},`;
  if (etapa === "inicial" || !f.resposta) {
    const queixa = f.reclamacao ? `: "${f.reclamacao}"` : ".";
    return [
      oi,
      `We've had a complaint from the customer about ${f.ref} (${f.servico}${f.dataDoJob ? `, ${f.dataDoJob}` : ""})${queixa}`,
      "We haven't agreed anything with the customer yet. Could you tell us what happened on the day and send a few photos of the finished work, if you have them? Please also let us know when you could go back to take another look.",
      ASSINATURA,
    ].join("\n\n");
  }
  const partes = [oi, `Thanks for your reply on ${f.ref}.`];
  if (!f.resposta.fotos) partes.push("Could you also send a few photos of the finished work? It helps us explain it to the customer.");
  if (f.resposta.remedy === "discount") {
    partes.push("We've noted what you proposed. We haven't agreed anything with the customer yet and will come back to you.");
  } else if (f.voltas.length) {
    partes.push(`We'll check with the customer which of the times you offered suits them: ${ou(f.voltas)}.`);
  } else {
    partes.push("Could you let us know when you could go back to take another look?");
  }
  partes.push("We'll let you know the next step.", ASSINATURA);
  return partes.join("\n\n");
}

/** O pedido que SAI ao parceiro no 7983. Leva o número do job: a resposta volta para o job certo. */
export function pedidoAoParceiro(f: Fatos, link: string | null): string {
  const queixa = f.reclamacao ? `: "${f.reclamacao}"` : ".";
  return [
    `Hi ${f.parceiro ?? "there"}, this is Fixfy about ${f.ref} (${f.servico}${f.dataDoJob ? `, ${f.dataDoJob}` : ""}).`,
    `The customer has raised a complaint${queixa}`,
    "We haven't agreed anything with the customer yet. Please reply to this message, today if you can, with:\n1. what you did on the day and when you left\n2. photos of the finished work\n3. when you could go back to take another look",
    link ? `Or send it all on this form: ${link}` : null,
    ASSINATURA,
  ].filter(Boolean).join("\n\n");
}

export function rascunhoParaCliente(f: Fatos, etapa: Etapa): string {
  const oi = `Hi ${f.cliente ?? "there"},`;
  if (etapa === "inicial" || !f.resposta) {
    return [
      oi,
      `Thanks for letting us know, and I'm sorry to hear you're not happy with the work on job ${f.ref}.`,
      "We're checking this with the professional who did the job and will come back to you with the next step. If you haven't already, could you send us a few photos of the problem? It helps us look into it properly.",
      ASSINATURA,
    ].join("\n\n");
  }
  const proximo =
    f.resposta.remedy !== "discount" && f.voltas.length
      ? `They can come back to take another look on ${ou(f.voltas)}. Would one of these work for you?`
      : "We'll come back to you shortly with the next step, which would usually be a visit to take another look.";
  return [
    oi,
    `A quick update on your complaint about job ${f.ref}: we've heard back from the professional and we're reviewing their reply now.`,
    proximo,
    ASSINATURA,
  ].join("\n\n");
}

/** Dinheiro, culpa e promessa: o John não escreve nada disso, nem em rascunho. */
const PROIBIDO: Array<[RegExp, string]> = [
  [/\b(refunds?|refunded|refunding|reimburs\w*|compensat\w*|discounts?|discounted|money back|credit note|vouchers?|goodwill)\b/i, "offers money"],
  [/\b(free of charge|no (extra )?(cost|charge)|at our (own )?expense|on us)\b/i, "offers money"],
  [/£\s?\d|\d+\s?%|\bpounds?\b/i, "mentions an amount"],
  [/\b(our fault|our mistake|we (made|got) (a mistake|it wrong)|we('re| are) (to blame|responsible)|we take (full )?responsibility|we admit|liab(le|ility)|negligen\w*)\b/i, "admits fault"],
  [/\b(we (will|'ll) (definitely |certainly )?(fix|redo|replace|pay|cover)|we guarantee|guaranteed)\b/i, "makes a promise"],
];

/** Números do texto que não estão na base (data, hora, valor inventado pelo modelo). */
export function numerosNovos(texto: string, base: string): string[] {
  const conhecidos = new Set(base.match(/\d+/g) ?? []);
  return [...new Set(texto.match(/\d+/g) ?? [])].filter((n) => !conhecidos.has(n));
}

export function conferirRascunho(
  texto: string,
  a: { publico: "cliente" | "parceiro"; nomesDoParceiro?: string[]; citacoes?: string[] },
): { ok: boolean; problemas: string[]; texto: string } {
  const base = conferirMensagem(texto, { publico: a.publico, nomesDeParceiros: a.publico === "cliente" ? a.nomesDoParceiro : [] });
  // A queixa citada ao parceiro pode ter "refund": é a fala do cliente, não do John.
  let semCitacao = base.texto;
  for (const c of a.citacoes ?? []) if (c.trim()) semCitacao = semCitacao.split(c.replace(/\s*[—–]\s*/g, ", ")).join(" ");
  const problemas = [...base.problemas];
  for (const [re, motivo] of PROIBIDO) if (re.test(semCitacao) && !problemas.includes(motivo)) problemas.push(motivo);
  return { ok: problemas.length === 0, problemas, texto: base.texto };
}

export type ChamarLLM = (sistema: string, usuario: string) => Promise<string>;

const SISTEMA = `You polish two short draft messages for Fixfy, a UK home-services company, about a customer complaint. A human will review them; nothing is sent.
Rewrite each draft so it reads like a calm, friendly person wrote it. British English. Keep it short (under 90 words each).
Hard rules: keep exactly the same facts, names, job references, dates and times; add NO new facts, numbers or promises. Never admit fault. Never mention refunds, discounts, compensation, money or prices. Never name the professional or their company to the customer. No em dashes. Keep the sign-off "Thanks,\\nFixfy Team".
Return strict JSON: {"partner": string|null, "customer": string}. "partner" is null when the partner draft is null.`;

/** O modelo reescreve; o que não passar na conferência volta para o modelo pronto. */
export async function polirComLLM(
  rascunhos: { parceiro: string | null; cliente: string },
  f: Fatos,
  chamar: ChamarLLM,
): Promise<{ parceiro: string | null; cliente: string; usouLLM: { parceiro: boolean; cliente: boolean } }> {
  const fallback = { ...rascunhos, usouLLM: { parceiro: false, cliente: false } };
  let j: { partner?: unknown; customer?: unknown };
  try {
    j = JSON.parse(await chamar(SISTEMA, JSON.stringify({ partner: rascunhos.parceiro, customer: rascunhos.cliente })));
  } catch {
    return fallback;
  }
  const aceitar = (novo: unknown, original: string | null, publico: "cliente" | "parceiro"): string | null => {
    if (!original || typeof novo !== "string" || novo.trim().length < 20) return null;
    if (numerosNovos(novo, original).length) return null;
    const c = conferirRascunho(novo, { publico, nomesDoParceiro: f.nomesDoParceiro, citacoes: [f.reclamacao] });
    return c.ok ? c.texto : null;
  };
  const parceiro = aceitar(j.partner, rascunhos.parceiro, "parceiro");
  const cliente = aceitar(j.customer, rascunhos.cliente, "cliente");
  return {
    parceiro: parceiro ?? rascunhos.parceiro,
    cliente: cliente ?? rascunhos.cliente,
    usouLLM: { parceiro: !!parceiro, cliente: !!cliente },
  };
}

/** O caso que a equipe lê antes de decidir: queixa, o que o parceiro disse e as saídas. */
export function resumoDoCaso(f: Fatos, job: JobDaReclamacao, etapa: Etapa, linhasDoJournal: LinhaDoJournal[] = [], soltas = 0): string {
  const s = job.on_hold_submission;
  const t0 = ms(job.on_hold_at);
  const falas = linhasDoJournal
    .filter((l) => l.job_id === job.id && l.author === "partner" && ms(l.created_at) >= t0)
    .map((l) => String(l.body ?? "").replace(/^\[WhatsApp [^\]]+\]\s*/, "").trim())
    .filter(Boolean)
    .slice(-4);
  const linhas = [`Complaint on ${f.ref}: ${f.reclamacao || "see the customer's message on this ticket"}`];
  if (etapa === "depois-da-resposta" && f.resposta) {
    const disse = [s?.notes?.trim(), ...falas].filter(Boolean).map((t) => `"${t!.slice(0, 300)}"`);
    linhas.push(`Partner replied: ${disse.length ? disse.join(" / ") : "see the job journal"}`);
    linhas.push(`Photos from the partner: ${f.resposta.fotos}`);
    if (f.voltas.length) linhas.push(`Return times offered: ${ou(f.voltas)}`);
    if (f.resposta.remedy === "discount") linhas.push("The partner proposed a discount instead of going back. Nothing agreed.");
  } else if (f.temParceiro) {
    linhas.push(`The partner has not replied in ${ESPERA_DO_PARCEIRO_H}h (or could not be reached on WhatsApp).`);
  } else {
    linhas.push("No partner on this job.");
  }
  if (soltas) linhas.push(`The partner also wrote ${soltas} message(s) on WhatsApp after our request without replying to it or naming the job: check /inbox in case they are about this.`);
  linhas.push("Options to decide: free return visit, charged return visit, or credit. John has not promised anything.");
  return linhas.join("\n");
}

/** A nota interna do ticket: Action Required, o caso, a marca e o rascunho ao cliente fechado por FIM. */
export function notaDoTicket(etapa: Etapa, rascunhoCliente: string, caso?: string): string {
  return [
    notaDaAcao("Complaint case ready. Read it, then apply the macro \"John: send reply\" to send the draft below as written, or reply yourself. Nothing was sent to the customer."),
    caso ?? null,
    `${etapa === "inicial" ? MARCA : MARCA_ATUALIZACAO}\n${rascunhoCliente}\n${FIM_DO_RASCUNHO}`,
  ].filter(Boolean).join("\n\n");
}

/** O rascunho mais recente do John nesta lista de comentários (interno), sem marca nem fim. */
export function rascunhoAprovavel(comentarios: ComentarioDoTicket[]): string | null {
  const internos = comentarios
    .filter((c) => c.public === false)
    .map((c) => ({ em: ms(c.created_at), t: (c.plain_body ?? c.body ?? "").replace(/\r/g, "") }))
    .filter((c) => c.t.includes(MARCA) && c.t.includes(FIM_DO_RASCUNHO))
    .sort((a, b) => b.em - a.em);
  const t = internos[0]?.t;
  if (!t) return null;
  const marca = t.includes(MARCA_ATUALIZACAO) ? MARCA_ATUALIZACAO : MARCA;
  const corpo = t.slice(t.indexOf(marca) + marca.length, t.indexOf(FIM_DO_RASCUNHO)).trim();
  return corpo.length >= 20 ? corpo : null;
}

/** O corpo do PUT no Zendesk: comentário SEMPRE interno, Action Required ligado. */
export function putDaNota(corpo: string) {
  return {
    ticket: {
      comment: { public: false, body: corpo },
      // O trigger "Auto-mark Reply Status = Sent" vira o Reply Status para 🟢 com qualquer nota
      // interna num ticket de job; o Action Required segura o ticket na fila ⚡ para a revisão.
      custom_fields: [{ id: ACTION_REQUIRED_FIELD_ID, value: ACTION_REQUIRED_YES }],
    },
  };
}

/** O texto da entrada do journal (o parceiro não vê: visible_to_partner = false). */
export function corpoDoJournal(
  etapa: Etapa,
  a: { parceiro: string | null; cliente: string; ticket: { id: number; postado: boolean; motivo?: string } | null },
): string {
  const partes = [etapa === "inicial" ? MARCA : MARCA_ATUALIZACAO];
  partes.push(a.parceiro ? `To the partner:\n${a.parceiro}` : "No partner on this job, so no partner draft.");
  if (a.ticket?.postado) {
    partes.push(`The draft reply to the customer is an internal note on ticket #${a.ticket.id}.`);
  } else {
    const onde = a.ticket ? ` (not on ticket #${a.ticket.id}: ${a.ticket.motivo ?? "could not post"})` : " (this job has no Zendesk ticket)";
    partes.push(`To the customer${onde}:\n${a.cliente}`);
  }
  return partes.join("\n\n").slice(0, 4000);
}

// ─── A passada ──────────────────────────────────────────────────────────────

export type ComentarioDoTicket = { public?: boolean; body?: string | null; plain_body?: string | null; created_at?: string | null };

export type ZendeskDoJohn = {
  lerTicket: (id: number) => Promise<{ status?: string | null; support_type?: string | null } | null>;
  lerComentarios: (id: number) => Promise<ComentarioDoTicket[]>;
  postarNota: (id: number, corpo: string) => Promise<void>;
  /** Tickets com a tag da macro "John: send reply". */
  ticketsComTag?: (tag: string) => Promise<number[]>;
  /** Comentário PÚBLICO (vai ao cliente pelo canal do ticket) e troca a tag da macro. */
  responderCliente?: (id: number, texto: string) => Promise<void>;
};

/** O 7983: manda e grava no /inbox. Devolve o wamid, que liga a resposta do parceiro ao job. */
export type ParceiroDoJohn = {
  enviar: (telefone: string, texto: string) => Promise<{ wamid: string }>;
  linkDoFormulario: (jobId: string, partnerId: string) => Promise<string | null>;
};

export type ResultadoDoJohn = { desligado: boolean; linhas: string[]; escritos: number };

/** A nota desta etapa já está no ticket (a passada anterior postou e caiu antes do journal)? */
export function notaJaNoTicket(comentarios: ComentarioDoTicket[], etapa: Etapa, desde: string | null): boolean {
  const t0 = ms(desde);
  return comentarios.some((c) => {
    if (c.public !== false) return false;
    if (Number.isFinite(t0) && ms(c.created_at) < t0) return false;
    return etapaDoRascunho((c.plain_body ?? c.body ?? "").replace(/\r/g, "")) === etapa;
  });
}

export type MensagemDoParceiro = {
  wamid: string;
  partner_id: string | null;
  tipo: string | null;
  texto: string | null;
  criado_em: string;
  bruto?: { quoted?: unknown } | null;
};

export const marcaDoWhatsApp = (wamid: string) => `[WhatsApp ${wamid}]`;

/**
 * De qual job é cada mensagem do parceiro no 7983 (dono, 12/11/2026: cliente e parceiro sempre
 * ligados no mesmo job). O parceiro usa o 7983 para tudo (agenda, report de outros jobs), então
 * só entra no job o que PROVA ser dele: resposta citando o pedido do John, ou o número do job
 * escrito. O resto que ele mandou depois do pedido fica em `depoisDoPedido`, para o caso avisar.
 * Ensaio de 12/11 com "um job só em reclamação = esse": 86 mensagens de agenda viraram evidência.
 */
export function ligarMensagensAoJob(
  msgs: MensagemDoParceiro[],
  jobs: JobDaReclamacao[],
  linhas: LinhaDoJournal[],
): { ligadas: Array<{ job: JobDaReclamacao; msg: MensagemDoParceiro }>; semJob: MensagemDoParceiro[]; depoisDoPedido: Map<string, number> } {
  const jobDoPedido = new Map<string, JobDaReclamacao>();
  const pedidoEm = new Map<string, number>();
  for (const l of linhas) {
    if (l.author !== "office" || !String(l.body ?? "").startsWith(MARCA_PEDIDO)) continue;
    const w = String(l.body).match(/\[wamid:([^\]]+)\]/)?.[1];
    const j = jobs.find((x) => x.id === l.job_id);
    if (w && j) jobDoPedido.set(w, j);
    if (j) pedidoEm.set(j.id, Math.min(pedidoEm.get(j.id) ?? Infinity, ms(l.created_at)));
  }
  const jaNoJournal = new Set(linhas.map((l) => String(l.body ?? "").match(/^\[WhatsApp ([^\]]+)\]/)?.[1]).filter(Boolean));
  const ligadas: Array<{ job: JobDaReclamacao; msg: MensagemDoParceiro }> = [];
  const semJob: MensagemDoParceiro[] = [];
  const depoisDoPedido = new Map<string, number>();
  for (const m of msgs) {
    if (!m.partner_id || jaNoJournal.has(m.wamid)) continue;
    const doParceiro = jobs.filter((j) => j.partner_id === m.partner_id && ms(m.criado_em) >= ms(j.on_hold_at));
    if (!doParceiro.length) continue;
    const citado = typeof m.bruto?.quoted === "string" ? m.bruto.quoted.split(":").pop() : null;
    let job = citado ? jobDoPedido.get(citado) ?? null : null;
    if (!job) {
      const refs = new Set((String(m.texto ?? "").toUpperCase().match(/JOB-?\s?\d{3,6}/g) ?? []).map((r) => `JOB-${r.replace(/\D/g, "")}`));
      const pelaRef = doParceiro.filter((j) => refs.has(j.reference.toUpperCase()));
      job = pelaRef.length === 1 ? pelaRef[0]! : null;
    }
    if (job) {
      ligadas.push({ job, msg: m });
      continue;
    }
    for (const j of doParceiro) {
      if (ms(m.criado_em) > (pedidoEm.get(j.id) ?? Infinity)) depoisDoPedido.set(j.id, (depoisDoPedido.get(j.id) ?? 0) + 1);
    }
    if (doParceiro.length > 1) semJob.push(m);
  }
  return { ligadas, semJob, depoisDoPedido };
}

export async function rodarJohn(
  sb: SupabaseClient,
  deps: {
    aplicar: boolean;
    env?: Record<string, string | undefined>;
    agora?: Date;
    zendesk?: ZendeskDoJohn | null;
    llm?: ChamarLLM | null;
    parceiro?: ParceiroDoJohn | null;
    detalhe?: boolean;
  },
): Promise<ResultadoDoJohn> {
  // Flag desligada: nada é lido nem escrito.
  const env = deps.env ?? process.env;
  if (!johnLigado(env)) return { desligado: true, linhas: [], escritos: 0 };
  const agora = deps.agora ?? new Date();
  const linhasDoLog: string[] = [];
  let escritos = 0;

  // A macro "John: send reply" vem primeiro: aprovação do dono não espera o resto.
  if (deps.zendesk?.ticketsComTag && deps.zendesk.responderCliente) {
    const r = await enviarAprovados(sb, deps.zendesk, deps.aplicar);
    linhasDoLog.push(...r.linhas);
    escritos += r.escritos;
  }

  const corte = new Date(agora.getTime() - JANELA_DIAS * 864e5).toISOString();
  const { data: jobsLidos, error } = await sb
    .from("jobs")
    .select(CAMPOS_DO_JOB)
    .eq("status", "on_hold")
    .is("deleted_at", null)
    .gte("on_hold_at", corte)
    .limit(300);
  if (error) throw new Error(`jobs: ${error.message}`);
  const jobs = ((jobsLidos ?? []) as unknown as JobDaReclamacao[]).filter((j) => jobOnHoldPorReclamacao(j));
  if (!jobs.length) return { desligado: false, linhas: [...linhasDoLog, "nenhum job em on hold por reclamação"], escritos };

  const { data: msgs, error: erroMsgs } = await sb
    .from("job_complaint_messages")
    .select("job_id, author, body, photos, created_at")
    .in("job_id", jobs.map((j) => j.id));
  if (erroMsgs) throw new Error(`job_complaint_messages: ${erroMsgs.message}`);
  const linhas = (msgs ?? []) as LinhaDoJournal[];

  // O que o parceiro mandou no 7983 depois do hold entra no journal do job (a evidência mora no job).
  const soltasDepoisDoPedido = new Map<string, number>();
  const pidsTodos = [...new Set(jobs.map((j) => j.partner_id).filter((p): p is string => !!p))];
  if (pidsTodos.length) {
    const desde = jobs.map((j) => j.on_hold_at!).sort()[0]!;
    const { data: wa } = await sb
      .from("wa_mensagens")
      .select("wamid, partner_id, tipo, texto, criado_em, bruto")
      .eq("direcao", "entrada")
      .in("partner_id", pidsTodos)
      .gte("criado_em", desde)
      .order("criado_em", { ascending: true })
      .limit(500);
    const { ligadas, semJob, depoisDoPedido } = ligarMensagensAoJob((wa ?? []) as MensagemDoParceiro[], jobs, linhas);
    for (const [id, n] of depoisDoPedido) soltasDepoisDoPedido.set(id, n);
    for (const { job, msg } of ligadas) {
      const midia = msg.tipo && msg.tipo !== "text" ? `(${msg.tipo} sent on WhatsApp, see /inbox)` : "";
      const linha: LinhaDoJournal = {
        job_id: job.id,
        author: "partner",
        body: `${marcaDoWhatsApp(msg.wamid)} ${[msg.texto?.trim(), midia].filter(Boolean).join(" ")}`.trim().slice(0, 4000),
        // A foto conta como evidência; o arquivo fica na conversa do /inbox.
        photos: [],
        created_at: msg.criado_em,
      };
      linhas.push(linha);
      if (deps.aplicar) {
        const { error: e } = await sb.from("job_complaint_messages").insert({
          job_id: linha.job_id, author: "partner", author_name: "Partner (WhatsApp)", body: linha.body, photos: [], visible_to_partner: true, created_by: null,
        });
        if (e) linhasDoLog.push(`${job.reference}: mensagem do parceiro no journal falhou (${e.message})`);
        else escritos++;
      }
    }
    if (ligadas.length) linhasDoLog.push(`${ligadas.length} mensagem(ns) do parceiro no 7983 ligada(s) ao job`);
    if (semJob.length) linhasDoLog.push(`${semJob.length} mensagem(ns) de parceiro com 2+ jobs em reclamação sem dizer qual: ficam no /inbox para a equipe`);
    const soltas = [...soltasDepoisDoPedido.values()].reduce((a, b) => a + b, 0);
    if (soltas) linhasDoLog.push(`${soltas} mensagem(ns) do parceiro depois do pedido sem citar nem dizer o job: o caso avisa, não liga`);
  }

  const aFazer = jobs
    .map((job) => ({ job, passo: passoDoJohn(job, linhas, agora) }))
    .filter((x): x is { job: JobDaReclamacao; passo: Exclude<Passo, "nada"> } => x.passo !== "nada")
    .slice(0, MAXIMO_POR_PASSADA);
  if (!aFazer.length) return { desligado: false, linhas: [...linhasDoLog, `${jobs.length} em reclamação, nada novo`], escritos };

  const pids = [...new Set(aFazer.map((x) => x.job.partner_id).filter((p): p is string => !!p))];
  const { data: parceiros } = pids.length
    ? await sb.from("partners").select("id, contact_name, company_name, phone, whatsapp").in("id", pids)
    : { data: [] };
  type Contato = { id: string; contact_name: string | null; company_name: string | null; phone: string | null; whatsapp: string | null };
  const contatoDe = new Map(((parceiros ?? []) as Contato[]).map((p) => [p.id, p]));

  for (const { job, passo } of aFazer) {
    const contato = job.partner_id ? contatoDe.get(job.partner_id) ?? null : null;
    const f = fatosDoJob(job, linhas, contato, agora);

    if (passo === "pedido") {
      const celular = normalizarMobileUk(contato?.whatsapp) ?? normalizarMobileUk(contato?.phone);
      let motivo: string | null = null;
      if (!johnAvisaParceiro(env)) motivo = "JOHN_AVISA_PARCEIRO is off";
      else if (!deps.parceiro) motivo = "WhatsApp 7983 not configured";
      else if (!celular) motivo = "partner has no UK mobile";
      const link = deps.aplicar && deps.parceiro && job.partner_id ? await deps.parceiro.linkDoFormulario(job.id, job.partner_id).catch(() => null) : null;
      const texto = pedidoAoParceiro(f, link);
      const c = conferirRascunho(texto, { publico: "parceiro", citacoes: [f.reclamacao] });
      if (!c.ok) motivo = `blocked by the check (${c.problemas.join("; ")})`;
      if (!deps.aplicar) {
        linhasDoLog.push(`${job.reference}: pedido ao parceiro (ensaio: ${motivo ? `não sairia, ${motivo}` : `sairia no 7983 para ${celular}`})`);
        if (deps.detalhe) linhasDoLog.push(`----- ${job.reference} pedido\n${texto}`);
        continue;
      }
      let corpo: string;
      let visivel = false;
      if (!motivo) {
        try {
          const { wamid } = await deps.parceiro!.enviar(celular!, c.texto);
          corpo = `${MARCA_PEDIDO} [wamid:${wamid}]\n${c.texto}`;
          visivel = true;
        } catch (e) {
          motivo = `WhatsApp failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`;
        }
      }
      if (motivo) corpo = `${MARCA_PEDIDO_NAO_ENVIADO} ${motivo}\n${texto}`;
      const { error: e } = await sb.from("job_complaint_messages").insert({
        job_id: job.id, author: "office", author_name: "John", body: corpo!.slice(0, 4000), photos: [], visible_to_partner: visivel, created_by: null,
      });
      if (e) linhasDoLog.push(`${job.reference}: pedido no journal falhou (${e.message})`);
      else {
        escritos++;
        linhas.push({ job_id: job.id, author: "office", body: corpo!, photos: [], created_at: agora.toISOString() });
      }
      linhasDoLog.push(`${job.reference}: pedido ao parceiro ${motivo ? `NÃO enviado (${motivo}); o caso vai à equipe na próxima passada` : "enviado no 7983"}`);
      continue;
    }

    const etapa: Etapa = passo;
    let parceiro = f.temParceiro ? rascunhoParaParceiro(f, etapa) : null;
    let cliente = rascunhoParaCliente(f, etapa);
    const cp = parceiro ? conferirRascunho(parceiro, { publico: "parceiro", citacoes: [f.reclamacao] }) : null;
    const cc = conferirRascunho(cliente, { publico: "cliente", nomesDoParceiro: f.nomesDoParceiro });
    if ((cp && !cp.ok) || !cc.ok) {
      linhasDoLog.push(`${job.reference}: rascunho barrado pela conferência (${[...(cp?.problemas ?? []), ...cc.problemas].join("; ")}), pulado`);
      continue;
    }
    parceiro = cp?.texto ?? null;
    cliente = cc.texto;
    let via = "modelo pronto";
    if (deps.aplicar && deps.llm) {
      const polido = await polirComLLM({ parceiro, cliente }, f, deps.llm).catch(() => null);
      if (polido) {
        ({ parceiro, cliente } = polido);
        if (polido.usouLLM.parceiro || polido.usouLLM.cliente) via = "gpt-4o-mini";
      }
    }
    const caso = resumoDoCaso(f, job, etapa, linhas, soltasDepoisDoPedido.get(job.id) ?? 0);

    // O caso e o rascunho ao cliente: nota interna no ticket do job, com Action Required.
    const ticketId = job.external_source === "zendesk" && /^\d+$/.test(job.external_ref?.trim() ?? "") ? Number(job.external_ref!.trim()) : null;
    let ticket: { id: number; postado: boolean; motivo?: string } | null = null;
    if (ticketId) {
      ticket = { id: ticketId, postado: false };
      if (!deps.zendesk) ticket.motivo = "Zendesk not configured";
      else {
        try {
          const t = await deps.zendesk.lerTicket(ticketId);
          if (!t) ticket.motivo = "ticket not found";
          else if (t.status === "closed" || t.status === "solved") ticket.motivo = `ticket is ${t.status}`;
          else if (t.support_type === "ai_agent") ticket.motivo = "Harvey is handling this WhatsApp ticket";
          else if (notaJaNoTicket(await deps.zendesk.lerComentarios(ticketId), etapa, job.on_hold_at)) ticket.postado = true;
          else if (deps.aplicar) {
            await deps.zendesk.postarNota(ticketId, notaDoTicket(etapa, cliente, caso));
            ticket.postado = true;
          } else ticket.postado = true; // ensaio: seria postada
        } catch (e) {
          ticket.motivo = `Zendesk error: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`;
        }
      }
    }

    const corpo = corpoDoJournal(etapa, { parceiro, cliente, ticket });
    const onde = ticket?.postado ? `nota interna #${ticket.id}` : "só journal";
    if (deps.detalhe) linhasDoLog.push(`----- ${job.reference}\n${corpo}${ticket?.postado ? `\n----- nota interna #${ticket.id}\n${notaDoTicket(etapa, cliente, caso)}` : ""}`);
    if (!deps.aplicar) {
      linhasDoLog.push(`${job.reference}: caso ${etapa} (ensaio: journal interno + ${onde})`);
      continue;
    }
    const { error: erroInsert } = await sb.from("job_complaint_messages").insert({
      job_id: job.id,
      author: "office",
      author_name: AUTOR,
      body: corpo,
      photos: [],
      visible_to_partner: false,
      created_by: null,
    });
    if (erroInsert) {
      linhasDoLog.push(`${job.reference}: journal falhou (${erroInsert.message})`);
      continue;
    }
    escritos++;
    linhasDoLog.push(`${job.reference}: caso ${etapa} gravado (journal interno + ${onde}, ${via})`);
  }
  return { desligado: false, linhas: linhasDoLog, escritos };
}

/**
 * A macro "John: send reply" (tag john_send) aprova o rascunho mais recente do ticket: ele sai
 * como comentário público, exatamente como está, e a tag vira john_sent. Sem rascunho do John
 * no ticket, ou rascunho que não passa na conferência, nada sai e a tag fica para a equipe ver.
 */
export async function enviarAprovados(
  sb: SupabaseClient,
  zd: ZendeskDoJohn,
  aplicar: boolean,
): Promise<{ linhas: string[]; escritos: number }> {
  const linhas: string[] = [];
  let escritos = 0;
  for (const id of (await zd.ticketsComTag!(TAG_ENVIAR)).slice(0, MAXIMO_POR_PASSADA)) {
    const texto = rascunhoAprovavel(await zd.lerComentarios(id));
    if (!texto) {
      linhas.push(`#${id}: macro aplicada mas sem rascunho do John no ticket, nada enviado`);
      continue;
    }
    const c = conferirRascunho(texto, { publico: "cliente" });
    if (!c.ok) {
      linhas.push(`#${id}: rascunho aprovado barrado pela conferência (${c.problemas.join("; ")}), nada enviado`);
      continue;
    }
    if (!aplicar) {
      linhas.push(`#${id}: rascunho aprovado sairia ao cliente (ensaio)`);
      continue;
    }
    await zd.responderCliente!(id, c.texto);
    escritos++;
    const { data: job } = await sb.from("jobs").select("id, reference").eq("external_source", "zendesk").eq("external_ref", String(id)).is("deleted_at", null).maybeSingle();
    if (job) {
      await sb.from("job_complaint_messages").insert({
        job_id: job.id, author: "office", author_name: "John", body: `[John sent the approved reply to the customer on ticket #${id}]\n${c.texto}`.slice(0, 4000), photos: [], visible_to_partner: false, created_by: null,
      });
    }
    linhas.push(`#${id}: rascunho aprovado enviado ao cliente${job ? ` (${job.reference})` : ""}`);
  }
  return { linhas, escritos };
}

// ─── Ligações de verdade (o script usa; o teste injeta as falsas) ───────────

export function zendeskDoJohn(): ZendeskDoJohn | null {
  if (!isZendeskConfigured()) return null;
  return {
    lerTicket: async (id) => (await zendeskApi<{ ticket?: { status?: string; support_type?: string } }>(`tickets/${id}.json`)).ticket ?? null,
    lerComentarios: async (id) =>
      (await zendeskApi<{ comments?: ComentarioDoTicket[] }>(`tickets/${id}/comments.json?sort_order=desc&per_page=30`)).comments ?? [],
    postarNota: async (id, corpo) => {
      await zendeskApi(`tickets/${id}.json`, { method: "PUT", body: putDaNota(corpo) });
    },
    ticketsComTag: async (tag) =>
      ((await zendeskApi<{ results?: Array<{ id: number }> }>(`search.json?query=${encodeURIComponent(`type:ticket tags:${tag}`)}`)).results ?? []).map((t) => t.id),
    responderCliente: async (id, texto) => {
      // Público: sai ao cliente pelo canal do ticket (e-mail ou WhatsApp). Action Required desliga:
      // a resposta devida foi dada.
      await zendeskApi(`tickets/${id}.json`, {
        method: "PUT",
        body: { ticket: { comment: { public: true, body: texto }, custom_fields: [{ id: ACTION_REQUIRED_FIELD_ID, value: null }] } },
      });
      await zendeskApi(`tickets/${id}/tags.json`, { method: "DELETE", body: { tags: [TAG_ENVIAR] } });
      await zendeskApi(`tickets/${id}/tags.json`, { method: "PUT", body: { tags: [TAG_ENVIADO] } });
    },
  };
}

/** O 7983 de verdade: uazapi + /inbox, e o link curto do formulário de on hold. */
export async function parceiroDoJohn(sb: SupabaseClient): Promise<ParceiroDoJohn | null> {
  const { operacaoProntaParaLembrete, enviarLembretePelaOperacao } = await import("@/lib/client-confirmation/lembrete-pela-operacao");
  if (operacaoProntaParaLembrete()) return null;
  const { createPartnerOnHoldToken } = await import("@/lib/quote-response-token");
  const { upsertShortLink, jobPartnerShortLinkEntityRef } = await import("@/lib/short-links");
  const { appBaseUrl } = await import("@/lib/app-base-url");
  return {
    enviar: (telefone, texto) => enviarLembretePelaOperacao(sb, telefone, texto, "John (complaint)"),
    linkDoFormulario: async (jobId, partnerId) => {
      const alvo = `/job/on-hold?token=${encodeURIComponent(createPartnerOnHoldToken(jobId, partnerId))}`;
      const r = await upsertShortLink({ targetPath: alvo, kind: "partner_on_hold", entityRef: jobPartnerShortLinkEntityRef(jobId, partnerId, "on_hold"), createdBy: null });
      return `${appBaseUrl()}${r.shortPath}`;
    },
  };
}

export function llmDoJohn(env: Record<string, string | undefined> = process.env): ChamarLLM | null {
  const chave = env.OPENAI_API_KEY?.trim();
  if (!chave) return null;
  return async (sistema, usuario) => {
    const res = await chamarOpenAI(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${chave}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: sistema },
            { role: "user", content: usuario },
          ],
        }),
      },
      { rotulo: "john-rascunho" },
    );
    if (!res.ok) throw new Error(`OpenAI john: HTTP ${res.status}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? "";
  };
}
