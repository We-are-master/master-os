/**
 * O lance faz o que o cliente pediu? Antes de virar preço, alguém tem que ler.
 *
 * O caso que abriu isto: QT-2026-1166 (ticket #51197). O cliente pediu DUAS
 * vezes que os batentes roídos fossem "restored with proper timber, not just
 * filler". O WHistyle Service cotou "fill deep indentations using wood filler".
 * Com 40% em cima, o preço ia para o cliente dizendo exatamente o contrário do
 * que ele pediu, e a primeira resposta seria "eu disse que não queria massa".
 * Quem salvou foi uma pessoa perguntando ao parceiro na side conversation.
 *
 * Este arquivo é a parte que pensa: compara o pedido com o lance, e depois lê
 * a resposta do parceiro. Não fala com ninguém e não grava nada; quem conversa
 * com o Zendesk e com o banco é o `quote-lances-sweep`. A chamada ao modelo é
 * injetável para os testes não tocarem na OpenAI.
 */
import { chamarOpenAI } from "@/lib/openai-com-retry";

/** O mesmo modelo do cérebro do Harvey (cerebro.ts). */
const MODELO = () => process.env.HARVEY_WA_MODEL?.trim() || "gpt-5.4";

/** Uma chamada ao modelo que devolve o texto JSON cru, ou lança. */
export type ChamadaAoModelo = (sistema: string, usuario: string) => Promise<string>;

export const chamarModeloJson: ChamadaAoModelo = async (sistema, usuario) => {
  const chave = process.env.OPENAI_API_KEY?.trim();
  if (!chave) throw new Error("sem OPENAI_API_KEY");
  const res = await chamarOpenAI(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${chave}` },
      body: JSON.stringify({
        model: MODELO(),
        reasoning_effort: "none",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sistema },
          { role: "user", content: usuario },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    },
    { rotulo: "escopo-do-lance" },
  );
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
  return j.choices?.[0]?.message?.content ?? "";
};

/** Regra do dono: travessão nunca, nem para parceiro. */
function semTravessao(t: string): string {
  return t.replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim();
}

function objetoJson(texto: string): Record<string, unknown> | null {
  try {
    const j = JSON.parse(texto.trim()) as unknown;
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/* ======================= 1. o lance bate com o pedido? ======================= */

export type VerificacaoDeEscopo = {
  diverge: boolean;
  motivo: string;
  /** A pergunta curta ao parceiro, em inglês. Vazia quando não diverge. */
  pergunta: string;
  /** false quando não deu para checar (sem texto, modelo caiu, JSON torto). */
  verificado: boolean;
};

const SISTEMA_VERIFICAR = [
  "You check a tradesperson's bid against what the customer asked for, before the price goes to the customer.",
  'Answer in strict JSON: {"diverge":boolean,"motivo":string,"pergunta":string}.',
  "",
  "diverge = true ONLY when the bid plainly does different or less work than the customer explicitly asked for:",
  "- a method or material the customer ruled out (customer: 'proper timber, not filler'; bid: 'wood filler'),",
  "- a part of the job the customer asked for that the bid leaves out,",
  "- a different item, room or quantity.",
  "diverge = false when the bid is just shorter, uses trade words, or does not mention details that are normally included. Do not nitpick.",
  "",
  "motivo: one short sentence for the office explaining the mismatch (empty when diverge is false).",
  "pergunta: when diverge is true, ONE short, friendly question to the tradesperson in UK English, at most three sentences.",
  "Quote what the customer asked for, say what their bid says, and ask them to confirm their price covers what the customer asked or to send a revised price.",
  "No greeting, no sign-off, no em dashes, no prices of ours, never mention margin. Empty when diverge is false.",
].join("\n");

/**
 * O pedido do cliente contra o escopo do lance.
 *
 * Falha calada, para o lado de sempre: se não dá para checar, devolve
 * `diverge: false` com `verificado: false`. O preço continua indo para
 * `quote_ready`, que é rascunho para gente ler, então o pior caso é o mesmo de
 * antes desta checagem existir. Quem chama põe o aviso na nota.
 */
export async function verificarEscopoDoLance(
  pedidoDoCliente: string,
  escopoDoLance: string,
  chamar: ChamadaAoModelo = chamarModeloJson,
): Promise<VerificacaoDeEscopo> {
  const pedido = pedidoDoCliente.trim();
  const escopo = escopoDoLance.trim();
  if (!pedido || !escopo) {
    return { diverge: false, motivo: !pedido ? "no customer request to compare" : "bid has no scope text", pergunta: "", verificado: false };
  }
  let cru: string;
  try {
    cru = await chamar(
      SISTEMA_VERIFICAR,
      `CUSTOMER ASKED FOR:\n${pedido.slice(0, 4000)}\n\nTRADESPERSON'S BID SCOPE:\n${escopo.slice(0, 2000)}`,
    );
  } catch (err) {
    return { diverge: false, motivo: `check failed: ${String(err).slice(0, 80)}`, pergunta: "", verificado: false };
  }
  return lerVerificacaoDeEscopo(cru) ?? { diverge: false, motivo: "check failed: model answer was not valid JSON", pergunta: "", verificado: false };
}

/**
 * Lê a resposta do modelo. Puro, para testar sem rede.
 *
 * `diverge: true` sem pergunta é resposta inútil (não há o que mandar ao
 * parceiro) e conta como inválida, não como "bate".
 */
export function lerVerificacaoDeEscopo(texto: string): VerificacaoDeEscopo | null {
  const j = objetoJson(texto);
  if (!j || typeof j.diverge !== "boolean") return null;
  const motivo = typeof j.motivo === "string" ? semTravessao(j.motivo).slice(0, 300) : "";
  const pergunta = typeof j.pergunta === "string" ? semTravessao(j.pergunta).slice(0, 600) : "";
  if (!j.diverge) return { diverge: false, motivo, pergunta: "", verificado: true };
  if (!pergunta) return null;
  return { diverge: true, motivo, pergunta, verificado: true };
}

/* ======================= 2. o que o parceiro respondeu? ======================= */

export type RespostaDoParceiro = { confirma: boolean; novo_valor?: number; resumo: string };

const SISTEMA_RESPOSTA = [
  "We asked a tradesperson whether their bid covers what the customer asked for. Read their reply.",
  'Answer in strict JSON: {"confirma":boolean,"novo_valor":number|null,"resumo":string}.',
  "",
  "confirma = true ONLY if they clearly agree to do the work the customer asked for (at the same price or at a new price).",
  "confirma = false if they decline, cannot do it that way, ask a question back, or the reply is unclear.",
  "novo_valor = the new TOTAL price in GBP they gave for the job, as a number. null if they kept their price or gave none.",
  "resumo = one or two sentences in UK English describing the work they have now agreed to do, written as a scope for the customer. No prices, no names, no em dashes.",
].join("\n");

export function lerRespostaDoParceiroJson(texto: string): RespostaDoParceiro | null {
  const j = objetoJson(texto);
  if (!j || typeof j.confirma !== "boolean") return null;
  const resumo = typeof j.resumo === "string" ? semTravessao(j.resumo).slice(0, 500) : "";
  const bruto = typeof j.novo_valor === "string" ? Number(j.novo_valor.replace(/[£,\s]/g, "")) : j.novo_valor;
  const novo = typeof bruto === "number" && Number.isFinite(bruto) && bruto > 0 ? Math.round(bruto * 100) / 100 : undefined;
  return novo !== undefined ? { confirma: j.confirma, novo_valor: novo, resumo } : { confirma: j.confirma, resumo };
}

/** O modelo lê a resposta. Null quando não deu para ler: vira caso para gente. */
export async function lerRespostaDoParceiro(
  pergunta: string,
  resposta: string,
  chamar: ChamadaAoModelo = chamarModeloJson,
): Promise<RespostaDoParceiro | null> {
  try {
    const cru = await chamar(SISTEMA_RESPOSTA, `OUR QUESTION:\n${pergunta.slice(0, 1500)}\n\nTHEIR REPLY:\n${resposta.slice(0, 3000)}`);
    return lerRespostaDoParceiroJson(cru);
  } catch {
    return null;
  }
}

export type PassoDepoisDaResposta = "seguir" | "revisar" | "pessoa";

/**
 * O que fazer com a resposta lida.
 *
 * Valor novo fora de metade a quatro vezes o lance não é revisão, é outro
 * trabalho (ou um erro de leitura): gente olha antes de virar preço.
 */
export function passoDepoisDaResposta(r: RespostaDoParceiro | null, valorOriginal: number): PassoDepoisDaResposta {
  if (!r || !r.confirma) return "pessoa";
  if (r.novo_valor === undefined || Math.abs(r.novo_valor - valorOriginal) < 0.005) return "seguir";
  if (valorOriginal > 0 && (r.novo_valor < valorOriginal * 0.5 || r.novo_valor > valorOriginal * 4)) return "pessoa";
  return "revisar";
}

/* ======================= marcas, eventos e textos ======================= */

/** Esperando o parceiro responder à pergunta de escopo. */
export const ESPERANDO_ESCOPO = "scope_check_waiting";
/** O parceiro não confirmou (ou não deu para ler): gente decide. A varredura não toca mais. */
export const ESCOPO_PRECISA_DE_GENTE = "scope_check_needs_person";
/** Tag no ticket para a pergunta ser fácil de achar. */
export const TAG_ESCOPO = "harvey_scope_check";

export type EsperaDeEscopo = { bidId: string; sideConversationId: string; perguntadoEm: number };

/**
 * A marca guarda tudo o que a próxima rodada precisa: qual lance, qual side
 * conversation e quando perguntamos. Não há coluna de metadados na quote, e
 * `automation_status` já é o lugar onde o Harvey lembra o que fez.
 */
export function marcaDeEspera(e: EsperaDeEscopo): string {
  return [ESPERANDO_ESCOPO, e.bidId, e.sideConversationId, String(e.perguntadoEm)].join("|");
}

export function lerMarcaDeEspera(marca: string | null | undefined): EsperaDeEscopo | null {
  const partes = String(marca ?? "").split("|");
  if (partes.length !== 4 || partes[0] !== ESPERANDO_ESCOPO) return null;
  const [, bidId, sideConversationId, quando] = partes;
  const perguntadoEm = Number(quando);
  if (!bidId || !sideConversationId || !Number.isFinite(perguntadoEm) || perguntadoEm <= 0) return null;
  return { bidId, sideConversationId, perguntadoEm };
}

/** A marca é de escopo (esperando ou parado com gente)? A cotação automática não pode precificar por cima. */
export function marcaDeEscopo(marca: string | null | undefined): boolean {
  const m = String(marca ?? "");
  return m === ESCOPO_PRECISA_DE_GENTE || m.startsWith(`${ESPERANDO_ESCOPO}|`);
}

export type EventoDeSideConversation = {
  created_at?: string;
  message?: { body?: string | null; from?: { email?: string | null } | null } | null;
};

/**
 * A primeira mensagem do parceiro depois da nossa pergunta.
 *
 * Casa pelo e-mail do parceiro. A nossa própria pergunta também é um evento da
 * mesma conversa, e confundir as duas faria o Harvey ler a si mesmo.
 */
export function respostaDoParceiro(
  eventos: EventoDeSideConversation[],
  perguntadoEm: number,
  emailDoParceiro: string,
): { texto: string; em: string } | null {
  const email = emailDoParceiro.trim().toLowerCase();
  if (!email) return null;
  const depois = eventos
    .filter((e) => e.message && e.created_at && new Date(e.created_at).getTime() > perguntadoEm)
    .filter((e) => (e.message?.from?.email ?? "").trim().toLowerCase() === email)
    .filter((e) => (e.message?.body ?? "").trim().length > 0)
    .sort((a, b) => a.created_at!.localeCompare(b.created_at!));
  const primeira = depois[0];
  return primeira ? { texto: primeira.message!.body!.trim(), em: primeira.created_at! } : null;
}

/**
 * O que o cliente pediu: o scope da quote mais o que ele escreveu no ticket.
 *
 * Só comentário PÚBLICO do requester. Nota interna é a equipe falando, e a
 * equipe às vezes resume errado; o caso 1166 estava nas palavras do cliente.
 */
export function pedidoDoCliente(
  scopeDaQuote: string | null | undefined,
  comentarios: Array<{ author_id?: number | null; public?: boolean; body?: string | null }>,
  requesterId: number | null | undefined,
): string {
  const doCliente = requesterId
    ? comentarios.filter((c) => c.public !== false && c.author_id === requesterId).map((c) => (c.body ?? "").trim()).filter(Boolean)
    : [];
  return [scopeDaQuote?.trim() ? `Quote scope: ${scopeDaQuote.trim()}` : null, ...doCliente.map((t) => `Customer wrote: ${t}`)]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 6000);
}

/** O escopo do lance: as descrições do BID_JSON, ou as notas sem a linha técnica. */
export function escopoDoLance(
  payload: { labourDescription: string | null; materialsDescription: string | null },
  notes: string | null | undefined,
): string {
  const partes = [
    payload.labourDescription ? `Work: ${payload.labourDescription}` : null,
    payload.materialsDescription ? `Materials: ${payload.materialsDescription}` : null,
  ].filter(Boolean);
  if (partes.length) return partes.join("\n");
  return String(notes ?? "").replace(/BID_JSON:\{[\s\S]*?\}\s*(?:\n|$)/, "").trim();
}

/**
 * As notas do lance com o valor revisado.
 *
 * O e-mail ao cliente sai das metades do BID_JSON, então só trocar o
 * `bid_amount` deixaria labour + materials somando o valor velho. O material
 * fica como o parceiro disse (se couber) e a mão de obra leva a diferença.
 */
export function notasComNovoValor(notes: string | null | undefined, novo: number, quando: string): string {
  const base = String(notes ?? "");
  const linha = `Revised to £${novo.toFixed(2)} by the partner in the side conversation (${quando}).`;
  const m = base.match(/BID_JSON:(\{[\s\S]*?\})(\s*(?:\n|$))/);
  if (!m) return [base.trim(), linha].filter(Boolean).join("\n");
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(m[1]!) as Record<string, unknown>;
  } catch {
    return [base.trim(), linha].filter(Boolean).join("\n");
  }
  const materiais = Number(j.materials_cost);
  const mat = Number.isFinite(materiais) && materiais > 0 && materiais < novo ? materiais : 0;
  const novoJson = { ...j, labour_cost: Math.round((novo - mat) * 100) / 100, materials_cost: mat };
  return `${base.replace(m[0], `BID_JSON:${JSON.stringify(novoJson)}${m[2]}`).trim()}\n${linha}`;
}

function escaparHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A mensagem ao parceiro na side conversation. */
export function htmlDaPergunta(referencia: string, pergunta: string): string {
  return `<p>Hi,</p><p>Quick check on your price for ${escaparHtml(referencia)} before we send it to the customer.</p><p>${escaparHtml(pergunta)}</p><p>Thanks,<br>Fixfy Team</p>`;
}
