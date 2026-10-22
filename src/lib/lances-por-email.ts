/**
 * Lance que o parceiro manda por e-mail vira lance de verdade (dono, 15/10/2026).
 *
 * O buraco: o WHistyle (e outros) respondem o convite de cotação no próprio
 * e-mail, que cai na side conversation do ticket. Ninguém transformava aquilo
 * em quote_bids, e a cotação parava esperando um lance que já tinha chegado.
 *
 * A cada ciclo do poll (mesmo lugar do varrerLancesParaRascunho, e ANTES dele):
 *   quote em `bidding` ligada a ticket → side conversations do ticket →
 *   mensagens de e-mail de parceiro convidado ainda não lidas → o modelo
 *   classifica:
 *     bid / revised_bid → grava pelo mesmo caminho do portal (gravar-lance.ts),
 *                         e a varredura de lances rascunha a quote como sempre;
 *     answer            → nota interna com a resposta (se mudou o preço, vira
 *                         lance revisado);
 *     other             → fica como está: o trigger do Zendesk já põe o ticket
 *                         em Action Required quando o parceiro responde.
 *   Fila de ação (fila-de-acao.ts): lance gravado tira o Action Required (o
 *   rascunho segue sozinho); resposta e preço novo em quote já precificada põem,
 *   com a próxima ação na nota.
 *
 * Trava de idempotência: o id do evento da side conversation vai para
 * `quote_partner_messages` (migration 329) depois que a ação deu certo.
 * Mensagem da pergunta de escopo pendente (quote-lances-sweep) não é lida
 * aqui: aquela resposta é do acompanhamento de escopo.
 *
 * Portas: só grava com HARVEY_RASCUNHO_LANCE=1 (o mesmo do rascunho) e
 * HARVEY_LANCE_EMAIL diferente de "0". Sem isso, só conta o que leria.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { replyToSideConversation, zendeskApi } from "@/lib/zendesk";
import { normalizeCalendarDateToYmd } from "@/lib/utils";
import { chaveDeEnvio, confirmarEnvio, falhouEnvio, reservarEnvio } from "@/lib/idempotencia/envio";
import { processoDaQuoteV2 } from "@/lib/processo/quote";
import { chamarModeloJson, lerMarcaDeEspera, type ChamadaAoModelo } from "@/lib/quote-lance-escopo";
import { buildBidNotesJson } from "@/lib/quote-bid-payload";
import { gravarLanceDoParceiro } from "@/lib/quotes/gravar-lance";
import { registrarDecisao } from "@/lib/harvey-wa/diario";
import { acaoFeita, precisaDeAcao } from "@/lib/fila-de-acao";
import { modoDe } from "@/lib/harvey/autonomia";

/** Mesma idade máxima da varredura de lances: quote velha não entra. */
const IDADE_MAXIMA_DIAS = 14;
/** Teto de mensagens classificadas por ciclo (cada uma é uma chamada ao modelo). */
const MAX_POR_CICLO = 8;

/* ============================== partes puras ============================== */

export type TipoDaMensagem = "bid" | "revised_bid" | "answer" | "question" | "other";

export type Classificacao = {
  tipo: TipoDaMensagem;
  total: number | null;
  labour: number | null;
  materials: number | null;
  duracao: string | null;
  notas: string | null;
  /** A resposta à nossa pergunta, nas palavras do parceiro (resumida). */
  resposta: string | null;
  /** A pergunta do parceiro, reescrita para o cliente (classe question). */
  pergunta?: string | null;
  /**
   * Até duas datas de início que o parceiro propôs (YYYY-MM-DD). Só são pedidas
   * ao modelo para conta com regras.v2 (etapa 3); fora disso vem vazia.
   */
  datas?: string[];
};

/** Evento como o Zendesk devolve em /side_conversations/{id}/events.json. */
export type EventoDaSc = {
  id?: string | number;
  created_at?: string;
  message?: { body?: string | null; from?: { email?: string | null } | null } | null;
};

export type MensagemDaSc = { id: string; scId: string; em: string; deEmail: string; texto: string };

/** E-mail nosso (equipe, Zendesk) nunca é parceiro. */
export function ehNosso(email: string): boolean {
  const e = email.trim().toLowerCase();
  return !e || /@getfixfy\.com$/.test(e) || /@[a-z0-9-]+\.zendesk\.com$/.test(e) || /^(no-?reply|mailer-daemon)@/.test(e);
}

/**
 * Só o que o parceiro escreveu agora: corta a citação do e-mail anterior
 * ("On Tue, ... wrote:", "-----Original Message-----", "From: ...", linhas com ">").
 */
export function semCitacao(texto: string): string {
  const linhas = String(texto ?? "").replace(/\r/g, "").split("\n");
  const fim = linhas.findIndex(
    (l) =>
      /^\s*On .{3,120}wrote:\s*$/i.test(l) ||
      /^\s*-{2,}\s*Original Message\s*-{2,}/i.test(l) ||
      /^\s*From:\s.+/i.test(l) ||
      /^\s*Sent from my (iPhone|Android|phone)/i.test(l) ||
      /^\s*>/.test(l),
  );
  return (fim === -1 ? linhas : linhas.slice(0, fim)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** As mensagens de e-mail da side conversation, do mais velho ao mais novo. */
export function mensagensDaSc(scId: string, eventos: readonly EventoDaSc[]): MensagemDaSc[] {
  return eventos
    .filter((e) => e.id != null && e.created_at && e.message)
    .map((e) => ({
      id: `sc:${scId}:${e.id}`,
      scId,
      em: e.created_at!,
      deEmail: String(e.message?.from?.email ?? "").trim().toLowerCase(),
      texto: semCitacao(String(e.message?.body ?? "")),
    }))
    .filter((m) => m.texto.length > 0)
    .sort((a, b) => a.em.localeCompare(b.em));
}

export type ParceiroComEmails = { id: string; email: string | null; job_cc_emails?: string[] | null; company_name?: string | null; contact_name?: string | null };

/** O parceiro dono do e-mail (principal ou cópia). Nosso e-mail nunca casa. */
export function parceiroDoEmail<T extends ParceiroComEmails>(email: string, parceiros: readonly T[]): T | null {
  const e = email.trim().toLowerCase();
  if (ehNosso(e)) return null;
  return parceiros.find((p) => [p.email, ...(p.job_cc_emails ?? [])].some((x) => String(x ?? "").trim().toLowerCase() === e)) ?? null;
}

function numero(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(/[£,\s]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function textoOuNull(v: unknown, max = 600): string | null {
  return typeof v === "string" && v.trim() ? v.replace(/\s*[—–]\s*/g, ", ").trim().slice(0, max) : null;
}

/**
 * A resposta do modelo, normalizada. Lance sem total não é lance (vira "other"),
 * e labour + materials sempre somam o total: o e-mail ao cliente sai das metades.
 */
/** Até duas datas válidas e diferentes, no formato YYYY-MM-DD. */
export function normalizarDatas(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const d of v) {
    const n = normalizeCalendarDateToYmd(typeof d === "string" ? d.slice(0, 10) : "");
    if (n && !out.includes(n)) out.push(n);
    if (out.length === 2) break;
  }
  return out;
}

export function lerClassificacaoJson(texto: string): Classificacao | null {
  let j: Record<string, unknown>;
  try {
    const bruto = JSON.parse(String(texto ?? "").trim()) as unknown;
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
    j = bruto as Record<string, unknown>;
  } catch {
    return null;
  }
  const tipos: TipoDaMensagem[] = ["bid", "revised_bid", "answer", "question", "other"];
  const tipo = tipos.includes(j.type as TipoDaMensagem) ? (j.type as TipoDaMensagem) : null;
  if (!tipo) return null;
  let total = numero(j.total);
  let labour = numero(j.labour);
  let materials = numero(j.materials);
  if (total === null && labour !== null) total = Math.round((labour + (materials ?? 0)) * 100) / 100;
  const base = { duracao: textoOuNull(j.duration, 120), notas: textoOuNull(j.notes), resposta: textoOuNull(j.answer), pergunta: textoOuNull(j.question), datas: normalizarDatas(j.dates) };
  if ((tipo === "bid" || tipo === "revised_bid") && total === null) return { tipo: "other", total: null, labour: null, materials: null, ...base };
  if (total !== null) {
    if (materials !== null && materials >= total) materials = null;
    labour = Math.round((total - (materials ?? 0)) * 100) / 100;
  }
  return { tipo, total, labour, materials, ...base };
}

export type PassoDaMensagem = "gravar_lance" | "nota_resposta" | "pergunta_ao_cliente" | "nada";

/**
 * O que fazer com a mensagem lida. Resposta que traz preço novo vale como lance
 * revisado; lance de quem já tinha lance também é revisão (o caminho é o mesmo).
 */
export function passoDaMensagem(c: Classificacao): PassoDaMensagem {
  if ((c.tipo === "bid" || c.tipo === "revised_bid") && c.total) return "gravar_lance";
  if (c.tipo === "answer") return c.total ? "gravar_lance" : "nota_resposta";
  if (c.tipo === "question" && c.pergunta) return "pergunta_ao_cliente";
  return "nada";
}

/** As notas do lance no formato do portal (BID_JSON), com a origem e o prazo do parceiro. */
export function notasDoLancePorEmail(c: Classificacao, a: { quando: string; textoDoParceiro: string }): string {
  const payload = {
    labour_cost: c.labour ?? c.total ?? 0,
    materials_cost: c.materials ?? 0,
    labour_pricing: "fixed" as const,
    materials_pricing: "bulk" as const,
    ...(c.notas ? { labour_description: c.notas } : {}),
    ...(c.datas?.[0] ? { start_date_option_1: c.datas[0] } : {}),
    ...(c.datas?.[1] ? { start_date_option_2: c.datas[1] } : {}),
  };
  const extra = [
    `Sent by email in the Zendesk side conversation (${a.quando}).`,
    c.duracao ? `Duration: ${c.duracao}.` : null,
    `Partner wrote: "${a.textoDoParceiro.slice(0, 800)}"`,
  ].filter(Boolean).join("\n");
  return buildBidNotesJson(payload, extra).slice(0, 4000);
}

export const SISTEMA_CLASSIFICACAO = [
  "A tradesperson replied by email to a UK home services company about a job we asked them to price. Read ONLY their new message.",
  'Answer in strict JSON: {"type":"bid"|"revised_bid"|"answer"|"question"|"other","total":number|null,"labour":number|null,"materials":number|null,"duration":string|null,"notes":string|null,"answer":string|null,"question":string|null}.',
  "",
  "type = bid when they give a price for the job (a total, or labour and materials).",
  "type = revised_bid when they change a price they gave before.",
  "type = answer when they answer a question we asked about the work, without a new price (if the answer comes with a new total price, put it in total).",
  "type = question when, without giving a price, they ask something only the customer can answer to price the job (access, parking, sizes, photos, materials or finish, timing, what exactly is wanted).",
  "type = other for anything else: questions about payment or our process, availability only, declining, thanks, out of office, unclear.",
  "question = for type question only: their question rewritten for the customer in one or two plain sentences, UK English, polite, no names, no prices, no em dashes.",
  "total = the full price in GBP for the whole job as a number, labour plus materials. null if none.",
  "labour, materials = the split if they gave one, else null. duration = how long the job takes if they said, short text.",
  "notes = one or two sentences in UK English describing the work they will do for that price (the scope). No prices, no names, no em dashes.",
  "answer = their answer to our question in one or two plain sentences in UK English, only for type answer. No em dashes.",
  "Never guess a number: only numbers they wrote.",
].join("\n");

/** Linhas extras do prompt quando a conta pede duas datas no lance (regras.v2). */
export const SISTEMA_DATAS = [
  'Also return "dates": an array with up to two start dates the tradesperson proposed for the job, as YYYY-MM-DD, earliest first. [] if they gave none.',
  "Resolve relative dates (\"next Tuesday\", \"the 28th\") using TODAY given in the message. Never invent a date they did not offer.",
].join("\n");

/* ===================== lance por e-mail sem as duas datas (etapa 3) ===================== */

/** Marca no corpo de quote_partner_messages: lance guardado, ainda sem as duas datas, fora do preço. */
export const MARCA_LANCE_INCOMPLETO = "INCOMPLETE_BID_NO_DATES:";

/** Lance que precisa das duas datas antes de valer (só conta v2, e só em leilão). */
export function faltamDatas(c: Pick<Classificacao, "datas">): boolean {
  return (c.datas?.length ?? 0) < 2;
}

export function corpoDoLanceIncompleto(c: Classificacao, textoDoParceiro: string): string {
  const json = JSON.stringify({ c, texto: textoDoParceiro.slice(0, 2000) });
  return `${MARCA_LANCE_INCOMPLETO}${json}`.slice(0, 4000);
}

/** O lance guardado sem datas, de volta. Corpo sem a marca (ou cortado): null. */
export function lerLanceIncompleto(corpo: string | null | undefined): { c: Classificacao; texto: string } | null {
  const s = String(corpo ?? "");
  if (!s.startsWith(MARCA_LANCE_INCOMPLETO)) return null;
  try {
    const j = JSON.parse(s.slice(MARCA_LANCE_INCOMPLETO.length)) as { c?: Classificacao; texto?: string };
    if (!j.c || !(Number(j.c.total) > 0)) return null;
    return { c: { ...j.c, datas: normalizarDatas(j.c.datas) }, texto: String(j.texto ?? "") };
  } catch {
    return null;
  }
}

/**
 * Junta o lance guardado com a mensagem nova do parceiro. Preço novo na
 * mensagem manda (é um lance revisado); sem preço, vale o guardado. As datas
 * somam: a nova primeiro, depois as do guardado, até duas.
 */
export function completarComDatas(pendente: Classificacao, nova: Classificacao): Classificacao {
  const base = nova.total ? nova : pendente;
  return { ...base, datas: normalizarDatas([...(nova.datas ?? []), ...(pendente.datas ?? [])]) };
}

/** O pedido das duas datas ao parceiro, na side conversation. Inglês, sem travessão. */
export function htmlDoPedidoDeDatas(referencia: string, total: number | null): string {
  const preco = total ? ` of £${total.toFixed(2)}` : "";
  return [
    `<p>Hi,</p>`,
    `<p>Thank you for your price${preco} for ${referencia}.</p>`,
    `<p>Before we can send it to the customer, could you reply with two dates you could start the job? For example: Tuesday 28 October or Thursday 30 October.</p>`,
    `<p>Thank you,<br>Fixfy Team</p>`,
  ].join("");
}

/** A chave da reserva do pedido de datas: uma vez por quote e parceiro. */
export function chaveDoPedidoDeDatas(quoteId: string, partnerId: string): string {
  return chaveDeEnvio("bid-datas", quoteId, partnerId);
}

/**
 * Pede as duas datas ao parceiro UMA vez (reserva antes de mandar). Devolve
 * "pediu", "ja_pediu" (outra rodada mandou ou está mandando) ou "falhou".
 */
export async function pedirDatasAoParceiro(
  sb: SupabaseClient,
  p: { quoteId: string; partnerId: string; referencia: string; total: number | null; ticketId: number; email: string | null },
  enviar: (html: string) => Promise<{ ok: boolean; id?: string | null; error?: string }>,
): Promise<"pediu" | "ja_pediu" | "falhou"> {
  const chave = chaveDoPedidoDeDatas(p.quoteId, p.partnerId);
  const r = await reservarEnvio(sb, { chave, finalidade: "bid-datas", canal: "email", quoteId: p.quoteId, ticketId: p.ticketId, destinatario: p.email, motivo: "partner bid by email without two date options" });
  if (!r.reservado) return "ja_pediu";
  try {
    const res = await enviar(htmlDoPedidoDeDatas(p.referencia, p.total));
    if (!res.ok) throw new Error(res.error ?? "side conversation reply failed");
    await confirmarEnvio(sb, chave, res.id ?? null);
    return "pediu";
  } catch (e) {
    await falhouEnvio(sb, chave, e);
    return "falhou";
  }
}

export async function classificarMensagem(
  a: { referencia: string; escopo: string | null; nossaUltima: string | null; texto: string; comDatas?: boolean; hoje?: string },
  chamar: ChamadaAoModelo = chamarModeloJson,
): Promise<Classificacao | null> {
  const usuario = [
    ...(a.comDatas ? [`TODAY is ${a.hoje ?? new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" })} (London).`] : []),
    `QUOTE ${a.referencia}. What the customer asked for: ${(a.escopo ?? "not given").slice(0, 1500)}`,
    a.nossaUltima ? `\nOUR LAST MESSAGE TO THEM:\n${a.nossaUltima.slice(0, 1500)}` : "",
    `\nTHEIR NEW MESSAGE:\n${a.texto.slice(0, 3000)}`,
  ].join("\n");
  const cru = await chamar(a.comDatas ? `${SISTEMA_CLASSIFICACAO}\n${SISTEMA_DATAS}` : SISTEMA_CLASSIFICACAO, usuario);
  const c = lerClassificacaoJson(cru);
  // Fora da v2 o lance segue como antes: sem datas no BID_JSON.
  return c && !a.comDatas ? { ...c, datas: [] } : c;
}

/* ============================== a varredura ============================== */

export type ResultadoDosLancesPorEmail = { armado: boolean; quotes: number; lidas: number; lances: number; respostas: number; outras: number; incompletos?: number; detalhes: string[] };

type QuoteDaLeitura = { id: string; reference: string; status: string; scope: string | null; external_ref: string; automation_status: string | null; source_account_id?: string | null; client_id?: string | null };

/** O lance deste parceiro guardado sem as duas datas (etapa 3), se houver. */
async function lanceIncompletoGuardado(supabase: SupabaseClient, quoteId: string, partnerId: string): Promise<{ messageId: string; c: Classificacao } | null> {
  const { data } = await supabase
    .from("quote_partner_messages")
    .select("message_id, body")
    .eq("quote_id", quoteId)
    .eq("partner_id", partnerId)
    .in("kind", ["bid", "revised_bid"])
    .is("bid_id", null)
    .order("created_at", { ascending: false })
    .limit(5);
  for (const linha of (data ?? []) as Array<{ message_id: string; body: string | null }>) {
    const l = lerLanceIncompleto(linha.body);
    if (l) return { messageId: linha.message_id, c: l.c };
  }
  return null;
}

function libras(v: number): string {
  return `£${v.toFixed(2)}`;
}

export async function lerLancesPorEmail(
  supabase: SupabaseClient,
  postarNotaInterna: (ticketId: number, corpo: string) => Promise<void>,
  opcoes: { chamar?: ChamadaAoModelo } = {},
): Promise<ResultadoDosLancesPorEmail> {
  const armado = (await modoDe("lances")) === "on" && process.env.HARVEY_LANCE_EMAIL !== "0";
  const r: ResultadoDosLancesPorEmail = { armado, quotes: 0, lidas: 0, lances: 0, respostas: 0, outras: 0, detalhes: [] };
  const desde = new Date(Date.now() - IDADE_MAXIMA_DIAS * 864e5).toISOString();
  const { data: quotes, error } = await supabase
    .from("quotes")
    .select("id, reference, status, scope, external_ref, automation_status, source_account_id, client_id")
    // Já precificada ou enviada: só entra se o Harvey perguntou algo ao parceiro pelo cliente (ask_partner).
    .in("status", ["bidding", "quote_ready", "awaiting_customer"])
    .eq("external_source", "zendesk")
    .not("external_ref", "is", null)
    .is("deleted_at", null)
    .gte("created_at", desde)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) {
    r.detalhes.push(`não consegui ler as quotes: ${error.message}`);
    return r;
  }

  for (const q of (quotes ?? []) as QuoteDaLeitura[]) {
    if (r.lidas >= MAX_POR_CICLO) break;
    const ticketId = Number(q.external_ref);
    if (!Number.isFinite(ticketId) || ticketId <= 0) continue;
    const emLeilao = q.status === "bidding";
    let desdeDaPergunta = 0;
    if (!emLeilao) {
      const { data: perguntas } = await supabase.from("quote_partner_messages").select("created_at").eq("quote_id", q.id).eq("kind", "question").order("created_at", { ascending: false }).limit(1);
      const ultima = ((perguntas ?? [])[0] as { created_at?: string } | undefined)?.created_at;
      if (!ultima) continue;
      desdeDaPergunta = Date.parse(ultima);
    }
    const { data: convites } = await supabase.from("quote_partner_invitations").select("partner_id").eq("quote_id", q.id);
    const ids = [...new Set(((convites ?? []) as Array<{ partner_id: string }>).map((c) => c.partner_id).filter(Boolean))];
    if (!ids.length) continue;
    const { data: ps } = await supabase.from("partners").select("id, email, job_cc_emails, company_name, contact_name, zendesk_user_id").in("id", ids);
    const parceiros = (ps ?? []) as Array<ParceiroComEmails & { zendesk_user_id?: number | string | null }>;
    r.quotes++;
    // Etapa 3: conta com regras.v2 pede duas datas no lance. Sem PROCESSOS_V2=on nem lê a conta.
    const pedeDatas = emLeilao && !!(await processoDaQuoteV2(supabase, q).catch(() => null));

    let scs: Array<{ id: string; participants?: Array<{ email?: string | null }> }> = [];
    try {
      scs = (await zendeskApi<{ side_conversations: typeof scs }>(`tickets/${ticketId}/side_conversations.json`)).side_conversations ?? [];
    } catch (err) {
      r.detalhes.push(`${q.reference}: não li as side conversations (${String(err).slice(0, 100)})`);
      continue;
    }
    const comParceiro = scs.filter((s) => s.participants?.some((x) => parceiroDoEmail(String(x.email ?? ""), parceiros))).slice(0, 10);
    const espera = lerMarcaDeEspera(q.automation_status);

    for (const sc of comParceiro) {
      if (r.lidas >= MAX_POR_CICLO) break;
      let eventos: EventoDaSc[] = [];
      try {
        eventos = (await zendeskApi<{ events?: EventoDaSc[] }>(`tickets/${ticketId}/side_conversations/${sc.id}/events.json`)).events ?? [];
      } catch {
        continue;
      }
      const todas = mensagensDaSc(sc.id, eventos);
      // A resposta à pergunta de escopo pendente é do quote-lances-sweep: não lê aqui.
      const candidatas = todas.filter(
        (m) =>
          parceiroDoEmail(m.deEmail, parceiros) &&
          Date.parse(m.em) > desdeDaPergunta &&
          !(espera && espera.sideConversationId === sc.id && Date.parse(m.em) >= espera.perguntadoEm),
      );
      if (!candidatas.length) continue;
      const { data: lidas, error: errLidas } = await supabase.from("quote_partner_messages").select("message_id").in("message_id", candidatas.map((m) => m.id));
      // Sem a trava (migration 329 não rodou) ele releria tudo a cada ciclo: para aqui.
      if (errLidas) {
        r.detalhes.push(`sem a tabela quote_partner_messages (rodar a migration 329): ${errLidas.message}`);
        return r;
      }
      const jaLidas = new Set(((lidas ?? []) as Array<{ message_id: string }>).map((l) => l.message_id));

      for (const m of candidatas.filter((x) => !jaLidas.has(x.id))) {
        if (r.lidas >= MAX_POR_CICLO) break;
        const parceiro = parceiroDoEmail(m.deEmail, parceiros)!;
        const nome = parceiro.company_name?.trim() || parceiro.contact_name?.trim() || "partner";
        r.lidas++;
        if (!armado) {
          r.detalhes.push(`[ensaio] ${q.reference}: e-mail de ${nome} ainda não lido (${m.em.slice(0, 16)})`);
          continue;
        }
        const nossaUltima = todas.filter((x) => x.em < m.em && !parceiroDoEmail(x.deEmail, parceiros)).at(-1)?.texto ?? null;
        let c: Classificacao | null;
        try {
          c = await classificarMensagem({ referencia: q.reference, escopo: q.scope, nossaUltima, texto: m.texto, comDatas: pedeDatas }, opcoes.chamar);
        } catch (err) {
          // Modelo fora do ar: não marca, tenta no próximo ciclo.
          r.detalhes.push(`${q.reference}: não consegui classificar o e-mail de ${nome} (${String(err).slice(0, 100)})`);
          continue;
        }
        const lida = c ?? { tipo: "other" as const, total: null, labour: null, materials: null, duracao: null, notas: null, resposta: null };
        let passo = passoDaMensagem(lida);
        // Etapa 3 (v2): lance sem as duas datas fica guardado fora do preço até o parceiro mandar as datas.
        let lance: Classificacao = lida;
        let pendente: { messageId: string; c: Classificacao } | null = null;
        let incompleto = false;
        if (pedeDatas) {
          pendente = await lanceIncompletoGuardado(supabase, q.id, parceiro.id).catch(() => null);
          // Só as datas, respondendo ao nosso pedido: completa o lance guardado.
          if (pendente && !lida.total && (lida.datas?.length ?? 0) > 0) passo = "gravar_lance";
          if (passo === "gravar_lance") {
            lance = pendente ? completarComDatas(pendente.c, lida) : lida;
            incompleto = faltamDatas(lance);
          }
        }
        let bidId: string | null = null;
        let perguntaEnviada = false;
        try {
          if (passo === "gravar_lance" && !emLeilao) {
            // Quote já precificada: preço novo não troca sozinho, gente decide (o trigger do Zendesk já pôs em Action Required).
            await postarNotaInterna(ticketId, [
              `🤖 HARVEY — ${nome} gave a new price by email on ${q.reference} (already ${q.status.replace(/_/g, " ")}): ${libras(lida.total!)}`,
              "",
              lida.resposta ? `Their answer: ${lida.resposta}` : null,
              `Partner wrote: "${m.texto.slice(0, 800)}"`,
              "",
              "Not applied: the quote is already priced. A person decides whether to re-quote the customer.",
            ].filter((l) => l !== null).join("\n"));
            await precisaDeAcao(ticketId, `${nome} gave a new price by email on ${q.reference} (${libras(lida.total!)}): decide whether to re-quote the customer`);
            r.respostas++;
          } else if (passo === "gravar_lance" && incompleto) {
            const pedido = await pedirDatasAoParceiro(
              supabase,
              { quoteId: q.id, partnerId: parceiro.id, referencia: q.reference, total: lance.total, ticketId, email: parceiro.email },
              async (html) => {
                const env = await replyToSideConversation({
                  ticketId,
                  sideConversationId: m.scId,
                  htmlBody: html,
                  toEmail: parceiro.email ?? m.deEmail,
                  toName: parceiro.contact_name || parceiro.company_name || undefined,
                  toUserId: parceiro.zendesk_user_id ?? null,
                  extraEmails: parceiro.job_cc_emails ?? undefined,
                });
                return { ok: env.ok, error: env.ok ? undefined : String(env.error ?? env.status ?? "failed") };
              },
            );
            if (pedido === "falhou") throw new Error("could not ask the partner for two dates");
            await postarNotaInterna(ticketId, [
              `🤖 HARVEY — bid by email from ${nome} on ${q.reference}: ${libras(lance.total!)}, held (not used for pricing yet)`,
              "",
              `It came without two start date options${lance.datas?.length ? ` (only ${lance.datas[0]})` : ""}.`,
              pedido === "pediu" ? "Asked the partner in their side conversation for two dates. When they reply, the bid is saved and priced as usual." : "Already asked the partner for two dates; waiting for their reply.",
              `Partner wrote: "${m.texto.slice(0, 500)}"`,
            ].join("\n"));
            r.incompletos = (r.incompletos ?? 0) + 1;
          } else if (passo === "gravar_lance") {
            const { data: antes } = await supabase.from("quote_bids").select("id, bid_amount").eq("quote_id", q.id).eq("partner_id", parceiro.id).maybeSingle();
            const g = await gravarLanceDoParceiro(supabase, {
              quoteId: q.id,
              quoteReference: q.reference,
              partnerId: parceiro.id,
              partnerName: nome,
              bidAmount: lance.total!,
              jobType: "fixed",
              notes: notasDoLancePorEmail(lance, { quando: m.em.slice(0, 16).replace("T", " "), textoDoParceiro: m.texto }),
              origem: "side_conversation_email",
            });
            if (!g.ok) throw new Error(g.error);
            bidId = g.bidId;
            // O lance guardado sem datas agora tem lance de verdade: sai da espera.
            if (pendente) await supabase.from("quote_partner_messages").update({ bid_id: bidId }).eq("message_id", pendente.messageId);
            const revisao = antes ? ` (was ${libras(Number(antes.bid_amount) || 0)})` : "";
            await postarNotaInterna(ticketId, [
              `🤖 HARVEY — ${antes ? "revised bid" : "bid"} by email from ${nome} on ${q.reference}: ${libras(lance.total!)}${revisao}`,
              "",
              lance.materials ? `Labour ${libras(lance.labour ?? 0)} + materials ${libras(lance.materials)}.` : null,
              lance.duracao ? `Duration: ${lance.duracao}.` : null,
              lance.notas ? `Scope: ${lance.notas}` : null,
              "",
              `Saved as their bid in the OS, so it goes through the normal draft. Partner wrote: "${m.texto.slice(0, 500)}"`,
            ].filter((l) => l !== null).join("\n"));
            r.lances++;
            // O trigger do Zendesk pôs Action Required ao chegar o e-mail; o lance já está no OS e segue para o rascunho.
            await acaoFeita(ticketId);
            await registrarDecisao({ origem: "lances", ticketId: q.external_ref, quoteRef: q.reference, decisao: `Read ${antes ? "a revised bid" : "a bid"} of ${libras(lance.total!)} from ${nome} in their email and saved it`, regra: "partner bid by email in the side conversation" }, supabase);
          } else if (passo === "pergunta_ao_cliente") {
            // B3: o parceiro precisa de algo do cliente para cotar: a pergunta vai ao cliente.
            const { perguntaDoParceiroAoCliente } = await import("@/lib/harvey/ponte-cliente-parceiro");
            const res = await perguntaDoParceiroAoCliente(supabase, { ticketId, quoteRef: q.reference, parceiroNome: nome, pergunta: lida.pergunta!, modo: await modoDe("perguntas") });
            perguntaEnviada = res.enviada;
            await postarNotaInterna(ticketId, [`🤖 HARVEY — ${nome} asked a question by email on ${q.reference}`, "", res.linha, `Partner wrote: "${m.texto.slice(0, 800)}"`].join("\n"));
            if (res.enviada) await acaoFeita(ticketId);
            await registrarDecisao({ origem: "lances", ticketId: q.external_ref, quoteRef: q.reference, decisao: res.enviada ? `Passed ${nome}'s question to the customer` : `${nome} asked a question (not sent: dry run or no channel)`, regra: "partner question by email" }, supabase);
            r.respostas++;
          } else if (passo === "nota_resposta") {
            // Resposta à pergunta que o CLIENTE fez (ask_partner): vai ao cliente na hora (B3).
            const { data: dele } = await supabase.from("quote_partner_messages").select("created_at").eq("quote_id", q.id).eq("kind", "question").lt("created_at", m.em).limit(1);
            let linha: string | null = null;
            if ((dele ?? []).length && lida.resposta) {
              const { respostaDoParceiroAoCliente } = await import("@/lib/harvey/ponte-cliente-parceiro");
              linha = await respostaDoParceiroAoCliente(supabase, { ticketId, quoteRef: q.reference, parceiroNome: nome, resposta: lida.resposta, modo: await modoDe("perguntas") });
            }
            await postarNotaInterna(ticketId, [
              `🤖 HARVEY — ${nome} answered by email on ${q.reference}`,
              "",
              lida.resposta ? `In short: ${lida.resposta}` : null,
              linha,
              `Partner wrote: "${m.texto.slice(0, 800)}"`,
            ].filter((l) => l !== null).join("\n"));
            if (linha?.startsWith("Partner answer sent")) await acaoFeita(ticketId);
            else if (!linha) await precisaDeAcao(ticketId, `${nome} answered by email on ${q.reference}: read the answer and decide the next step`);
            r.respostas++;
          } else {
            r.outras++;
          }
        } catch (err) {
          // Não marca: tenta de novo no próximo ciclo.
          r.detalhes.push(`${q.reference}: e-mail de ${nome} lido, mas a ação falhou (${String(err).slice(0, 120)})`);
          continue;
        }
        const tipo =
          passo === "gravar_lance" ? (lida.tipo === "bid" ? "bid" : "revised_bid") : lida.tipo === "question" ? (perguntaEnviada ? "partner_question" : "other") : lida.tipo;
        const { error: errMarca } = await supabase.from("quote_partner_messages").insert({
          message_id: m.id,
          quote_id: q.id,
          partner_id: parceiro.id,
          ticket_id: ticketId,
          side_conversation_id: m.scId,
          kind: tipo,
          body: incompleto ? corpoDoLanceIncompleto(lance, m.texto) : (lida.pergunta ?? lida.resposta ?? m.texto).slice(0, 4000),
          amount: passo === "gravar_lance" ? lance.total : lida.total,
          bid_id: bidId,
        });
        if (errMarca) r.detalhes.push(`${q.reference}: não marquei o e-mail como lido (${errMarca.message})`);
        r.detalhes.push(`${q.reference}: e-mail de ${nome} → ${tipo}${incompleto ? " (sem as duas datas, guardado)" : ""}${lance.total ? ` ${libras(lance.total)}` : ""}`);
      }
    }
  }
  return r;
}
