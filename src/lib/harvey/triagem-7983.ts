/**
 * A triagem do Harvey lê o 7983 (dono, 10/11/2026). Desde o #965 o lembrete de
 * véspera sai pelo número da operação, e a resposta do cliente ("dá para mudar?",
 * "que horas?", "ninguém veio", "ok obrigado") cai só na /inbox, onde nenhum
 * agente olha.
 *
 * Mensagem de CLIENTE que chega no 7983 vira uma classe:
 *
 *   confirmacao   ok, obrigado, oi, 👍: nada a fazer
 *   remarcacao    pede outro dia ou horário
 *   horario       pergunta a hora de chegada
 *   cancelamento  quer cancelar
 *   reclamacao    reclamação ou ninguém apareceu
 *   outro         o resto: fica na /inbox, não sobe
 *
 * Regra primeiro (de graça); o modelo barato só quando a regra não decide ou
 * acha duas classes. Tudo que não é `confirmacao` liga o Action Required no
 * ticket do job ativo do cliente, com a frase dele. Nada vai ao cliente, o
 * status do job não muda e nenhum ticket nasce.
 *
 * Desligado por padrão: HARVEY_TRIAGEM_7983=1 liga. Desligado, o webhook faz
 * exatamente o que fazia: nem banco, nem rede, nem import novo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { depoisDaResposta } from "@/lib/depois-da-resposta";
import type { Decisao } from "./decisoes";
import { escolherJobAtivo, type JobDoCliente } from "@/lib/harvey-wa/job-ativo";
import { filtroDoNumero, finalDoNumero } from "@/lib/whatsapp/operacao";
import { extrairMensagemUazapi, parceiroDoNumero, type MensagemUazapi } from "@/lib/whatsapp/uazapi-operacao";

export const triagem7983Ligada = () => process.env.HARVEY_TRIAGEM_7983?.trim() === "1";

export type Classe7983 = "confirmacao" | "remarcacao" | "horario" | "cancelamento" | "reclamacao" | "outro";

/** A classe como fica em harvey_decisoes.classe (o rótulo em inglês está em decisoes.ts). */
export const classeNaMedida = (c: Classe7983) => `7983_${c}`;

// ─── Regras ─────────────────────────────────────────────────────────────────

/**
 * Só estas palavras, e nada mais, fazem "nada a fazer". Lista fechada de
 * propósito: confirmação errada é a mensagem que some, as outras classes no
 * pior caso põem o ticket na fila à toa.
 */
const SO_CONFIRMA = new Set(
  [
    "ok", "okay", "okey", "k", "kk", "yes", "yep", "yeah", "yea", "sure", "perfect", "great", "brilliant", "lovely", "fine", "good", "nice", "cool", "fab", "fantastic", "amazing", "excellent", "awesome",
    "that", "thats", "that's", "sounds", "all", "is", "it", "be", "will", "i", "we", "ll", "i'll", "we'll", "i'm", "im", "home", "there", "in",
    "thanks", "thank", "you", "so", "much", "very", "many", "cheers", "ta", "noted", "confirmed", "received", "got",
    "see", "tomorrow", "then", "hi", "hello", "hey", "morning", "afternoon", "evening", "team", "fixfy",
    "bom", "dia", "boa", "tarde", "noite", "obrigado", "obrigada", "valeu", "certo", "beleza", "sim", "perfeito", "combinado",
  ],
);

const CLASSES_POR_REGRA: ReadonlyArray<{ classe: Exclude<Classe7983, "confirmacao" | "outro">; re: RegExp }> = [
  {
    classe: "reclamacao",
    // "no one arrived", "no one was there", "nobody came", "still waiting", "Again delays…" (mensagens reais do 7983).
    re: /\b(?:no ?one|nobody)\b.{0,25}\b(?:came|arrived|turned up|showed|shown up|was there|was here|is here|at the door|has come|have come)|\b(?:did ?n[o'’]?t|has ?n[o'’]?t|have ?n[o'’]?t|never)\s+(?:turn(?:ed)? up|show(?:ed)? up|shown up|arrive|arrived|come|came)\b|\bstill waiting\b|\bbeen waiting\b|\bno.?show\b|\bcomplain|\bnot happy\b|\bunhappy\b|\bdisappoint|\bunacceptable\b|\bterrible\b|\bawful\b|\bdisgust|\brefund\b|\bdamaged?\b|\bpoor (?:job|work|service)\b|\bwaste of (?:my )?time\b|\bfrustrat|\bdelays\b/i,
  },
  {
    classe: "cancelamento",
    re: /\bcancel(?:l?ed|l?ing|lation)?\b|\bno longer (?:need|require|want)\b|\bdon['’]?t need (?:it|this|the (?:visit|job|booking|appointment)|you) (?:any ?more|now)\b|\bcancelar\b/i,
  },
  {
    classe: "remarcacao",
    // "I might not be home between 12pm and 3pm. Would it be possible for the handyman to come after 4:30pm instead?"
    re: /\bre-?schedul|\bre-?book|\brearrange|\bpostpone|\bmove (?:it|this|the (?:visit|appointment|booking|job|time|date))\b|\bchange (?:the |my )?(?:date|time|day|slot|appointment|booking)\b|\b(?:another|different|other|later|earlier) (?:day|date|time|slot)\b|\bcome (?:after|before|later|earlier) \d|\b(?:won['’]?t|will not|might not|may not|can['’]?t|cannot|not going to) be (?:home|in|there|around|available)\b|\bcan['’]?t make (?:it|tomorrow|that)\b|\bremarcar\b/i,
  },
  {
    classe: "horario",
    // "please confirm when they will arrive", "can you let me know if he will be arriving soon?"
    re: /\bwhat time\b|\b(?:eta|arrival time)\b|\bwhen (?:will|is|are|would|does|do) (?:he|she|they|someone|the \w+|your \w+)\b.{0,30}\b(?:arriv|com|be (?:here|there)|get here|turn up)|\bwhen (?:he|she|they|someone|the \w+) (?:will|would|is|are)\b.{0,15}\b(?:arriv|com|be (?:here|there))|\barriving soon\b|\b(?:is|are) (?:he|she|they) (?:still )?(?:coming|on (?:his|her|their|the) way)\b|\bhow long (?:will|until|till)\b|\brunning late\b|\bque horas\b/i,
  },
];

const EMOJI_RUIM = /[🙄😡😠🤬😤😒👎😞😢😭😩😫😕🤨]/u;

/** Tira emoji e pontuação para comparar palavra por palavra. */
function palavras(texto: string): string[] {
  return texto
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * A classe pelas regras, ou null quando a regra não sabe (aí vai ao modelo).
 * Duas classes ao mesmo tempo ("cancel and rebook") também é null: ambiguidade
 * não se decide por regex.
 */
export function classePorRegra(texto: string | null, tipo: string): Classe7983 | null {
  if (tipo === "sticker") return "confirmacao";
  const t = String(texto ?? "").trim();
  if (tipo !== "text" && (!t || /^(?:Photo|Voice note|Video|Document|Location)$/.test(t))) return "outro";
  if (!t) return "confirmacao";
  const ws = palavras(t);
  // Só emoji: 👍 é nada a fazer, 🙄 (visto no 7983) não é.
  if (!ws.length && EMOJI_RUIM.test(t)) return null;
  if (!t.includes("?") && ws.length <= 8 && ws.every((w) => SO_CONFIRMA.has(w))) return "confirmacao";
  const achadas = CLASSES_POR_REGRA.filter((r) => r.re.test(t)).map((r) => r.classe);
  return achadas.length === 1 ? achadas[0] : null;
}

// ─── Modelo ─────────────────────────────────────────────────────────────────

const DO_MODELO: Record<string, Classe7983> = {
  confirmation: "confirmacao",
  reschedule: "remarcacao",
  eta: "horario",
  cancellation: "cancelamento",
  complaint: "reclamacao",
  other: "outro",
};

/** gpt-4o-mini, como os vigias do zendesk-quoter. Sem chave ou com erro: `outro`, que é o lado seguro. */
export async function classePeloModelo(texto: string, apiKey: string | undefined = process.env.OPENAI_API_KEY): Promise<Classe7983> {
  if (!apiKey?.trim()) return "outro";
  try {
    const { chamarOpenAI } = await import("@/lib/openai-com-retry");
    const res = await chamarOpenAI(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                'A home-services customer wrote to us on WhatsApp, usually about a booked visit (we send a reminder the day before). Classify the message. Strict JSON: {"class":"confirmation"|"reschedule"|"eta"|"cancellation"|"complaint"|"other"}. confirmation = only acknowledges, thanks or greets, nothing for us to do. reschedule = wants another day or time, or will not be available. eta = asks when the professional arrives. cancellation = wants to cancel. complaint = unhappy, damage, no-show, delays. other = anything else that needs a reply or action. When unsure, use "other".',
            },
            { role: "user", content: texto.slice(0, 1500) },
          ],
        }),
      },
      { rotulo: "triagem-7983" },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const j = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as { class?: unknown };
    return DO_MODELO[String(j.class ?? "")] ?? "outro";
  } catch (e) {
    console.error("[triagem-7983] modelo", e instanceof Error ? e.message : e);
    return "outro";
  }
}

// ─── A linha da fila ────────────────────────────────────────────────────────

/** A frase do cliente, curta, para caber na linha do Action Required. */
export function citacao(texto: string | null, max = 120): string {
  const t = String(texto ?? "").replace(/\s+/g, " ").replace(/"/g, "'").trim();
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
}

const O_QUE_FAZER: Record<Exclude<Classe7983, "confirmacao">, string> = {
  remarcacao: "Client asked to reschedule on the 07 WhatsApp",
  horario: "Client asked for the arrival time on the 07 WhatsApp",
  cancelamento: "Client wants to cancel, said on the 07 WhatsApp",
  reclamacao: "Client complaint or no-show on the 07 WhatsApp",
  outro: "Client wrote on the 07 WhatsApp",
};

const E_DEPOIS: Record<Exclude<Classe7983, "confirmacao">, string> = {
  remarcacao: "agree a new slot and update the job",
  horario: "reply with the ETA",
  cancelamento: "confirm with the client and cancel the job",
  reclamacao: "call the client and check with the partner",
  outro: "reply in /inbox",
};

/** A próxima ação, em inglês e numa linha, com a frase do cliente. */
export function proximaAcao7983(classe: Exclude<Classe7983, "confirmacao">, texto: string | null): string {
  const frase = citacao(texto);
  return `${O_QUE_FAZER[classe]}${frase ? `: "${frase}"` : ""}. Next: ${E_DEPOIS[classe]}`;
}

// ─── Quem é e qual job ──────────────────────────────────────────────────────

export type JobDaMensagem = JobDoCliente & { reference: string | null };

const DIAS_DA_RECLAMACAO = 14;
const recentePrimeiro = (a: JobDaMensagem, b: JobDaMensagem) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "");

/**
 * O job do ticket que sobe. O ativo, pela mesma regra da conversa do Harvey
 * (job-ativo.ts); senão Finding partner ou Needs attention; reclamação ainda
 * olha o concluído dos últimos 14 dias, porque chega depois da visita.
 */
export function jobDaMensagem(jobs: JobDaMensagem[], classe: Classe7983, hoje: string): JobDaMensagem | null {
  const comTicket = jobs.filter((j) => j.external_source === "zendesk" && /^\d+$/.test(j.external_ref ?? ""));
  const ativo = escolherJobAtivo(comTicket, hoje);
  if (ativo) return comTicket.find((j) => j.id === ativo.jobId) ?? null;
  const quase = comTicket.filter((j) => j.status === "auto_assigning" || j.status === "need_attention").sort(recentePrimeiro);
  if (quase[0]) return quase[0];
  if (classe !== "reclamacao") return null;
  const corte = new Date(Date.parse(`${hoje}T12:00:00Z`) - DIAS_DA_RECLAMACAO * 864e5).toISOString().slice(0, 10);
  return comTicket.filter((j) => j.status === "completed" && (j.scheduled_date ?? "") >= corte).sort(recentePrimeiro)[0] ?? null;
}

/**
 * Os clientes do número, como a /inbox decide (dados.ts): o vínculo feito à mão
 * vale mais; parceiro ou conta não é cliente; senão o telefone do cadastro.
 */
async function clientesDoContato(sb: SupabaseClient, contato: string): Promise<string[]> {
  const { data: conversa, error } = await sb.from("inbox_conversas").select("vinculo_tipo, vinculo_id").eq("contato", contato).maybeSingle();
  // Sem a 355 a coluna não existe: segue pelo telefone.
  const v = error ? null : (conversa as { vinculo_tipo?: string | null; vinculo_id?: string | null } | null);
  if (v?.vinculo_tipo && v.vinculo_id) return v.vinculo_tipo === "cliente" ? [v.vinculo_id] : [];
  if (await parceiroDoNumero(sb, contato)) return [];
  const fim = finalDoNumero(contato);
  if (fim.length < 10) return [];
  const { data } = await sb.from("clients").select("id, phone").is("deleted_at", null).or(filtroDoNumero("phone", fim)).limit(10);
  return ((data ?? []) as Array<{ id: string; phone: string | null }>).filter((c) => finalDoNumero(c.phone) === fim).map((c) => c.id);
}

// ─── O fluxo ────────────────────────────────────────────────────────────────

/** Mensagem que a triagem lê: entrada, 1 a 1, e não reação (essa pendura em outra). */
export function mensagemParaTriagem(payload: unknown): MensagemUazapi | null {
  const m = extrairMensagemUazapi(payload);
  if ("pular" in m || m.direcao !== "entrada" || m.grupo || m.tipo === "reaction") return null;
  return m;
}

export type ResultadoDaTriagem = { feito: string; classe?: Classe7983; ticketId?: number | null };

type Dependencias = {
  classePeloModelo: (texto: string) => Promise<Classe7983>;
  precisaDeAcao: (ticketId: number, proximaAcao: string) => Promise<{ ok: boolean; linha: string }>;
  registrarMedida: (sb: SupabaseClient, d: Decisao) => Promise<void>;
  agora: Date;
};

/** Lê, classifica e sobe para a equipe. Erro aqui vira log no depoisDaResposta, nunca no webhook. */
export async function triarMensagemDo7983(sb: SupabaseClient, m: MensagemUazapi, deps: Partial<Dependencias> = {}): Promise<ResultadoDaTriagem> {
  const agora = deps.agora ?? new Date();
  const registrar = deps.registrarMedida ?? (await import("./decisoes")).registrarMedida;
  const marca = `7983 wamid:${m.wamid}`;

  // A uazapi reentrega: a mesma mensagem não vira duas medidas nem duas chamadas ao modelo.
  const { data: vista } = await sb
    .from("harvey_decisoes")
    .select("id")
    .like("detalhe", `${marca}%`)
    .gte("criado_em", new Date(agora.getTime() - 2 * 864e5).toISOString())
    .limit(1);
  if ((vista ?? []).length) return { feito: "já triada" };

  const clientes = await clientesDoContato(sb, m.contato);
  if (!clientes.length) return { feito: "não é cliente" };

  const classe = classePorRegra(m.texto, m.tipo) ?? (await (deps.classePeloModelo ?? classePeloModelo)(String(m.texto ?? "")));
  const frase = citacao(m.texto, 200);
  if (classe === "confirmacao") {
    await registrar(sb, { canal: "whatsapp", ticketId: null, classe: classeNaMedida(classe), acao: "ignorado", resultado: "ok", detalhe: `${marca} · "${frase}"`, statusEsperado: null });
    return { feito: "nada a fazer", classe };
  }

  const { data: jobs } = await sb
    .from("jobs")
    .select("id, reference, status, scheduled_date, updated_at, external_source, external_ref")
    .in("client_id", clientes)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(20);
  const job = jobDaMensagem((jobs ?? []) as JobDaMensagem[], classe, agora.toISOString().slice(0, 10));
  const base = { canal: "whatsapp" as const, classe: classeNaMedida(classe), acao: "nota_de_triagem" as const, referencia: job?.reference ?? null, statusEsperado: null };
  if (!job) {
    await registrar(sb, { ...base, ticketId: null, resultado: "faltando", detalhe: `${marca} · no active job with a Zendesk ticket · "${frase}"` });
    return { feito: "sem job ativo", classe, ticketId: null };
  }
  const ticketId = Number(job.external_ref);

  // "outro" não sobe (dono, 10/11/2026): o 7983 é conversa ao vivo e a mensagem já está na
  // /inbox. Só pedido claro (remarcar, horário, cancelar, reclamação) vira Action Required,
  // para a fila do dono não encher de "ok, see you" que a regra não reconheceu.
  if (classe === "outro") {
    await registrar(sb, { ...base, ticketId, acao: "ignorado", resultado: "ok", detalhe: `${marca} · stays in /inbox · "${frase}"` });
    return { feito: "fica na /inbox", classe, ticketId };
  }

  const subir = deps.precisaDeAcao ?? (await import("@/lib/fila-de-acao")).precisaDeAcao;
  const r = await subir(ticketId, proximaAcao7983(classe, m.texto));
  await registrar(sb, { ...base, ticketId, resultado: r.ok ? "nota" : "falhou", detalhe: `${marca} · ${r.linha} · "${frase}"` });
  return { feito: r.linha, classe, ticketId };
}

/**
 * O que o webhook chama depois de gravar. Desligado: devolve false sem tocar em
 * nada. Ligado: agenda a triagem para depois da resposta (depois-da-resposta.ts),
 * então a uazapi recebe o 200 no mesmo tempo de sempre.
 */
export async function agendarTriagem7983(sb: SupabaseClient, payload: unknown, resultado: string): Promise<boolean> {
  if (!triagem7983Ligada()) return false;
  if (resultado !== "gravada") return false;
  try {
    const m = mensagemParaTriagem(payload);
    if (!m) return false;
    await depoisDaResposta("triagem-7983", async () => {
      const r = await triarMensagemDo7983(sb, m);
      console.log(`[triagem-7983] …${m.contato.slice(-4)} ${r.classe ?? ""} ${r.feito}`);
    });
    return true;
  } catch (e) {
    // O webhook responde 200 de qualquer jeito: a triagem nunca derruba a gravação.
    console.error("[triagem-7983] agendar", e instanceof Error ? e.message : e);
    return false;
  }
}
