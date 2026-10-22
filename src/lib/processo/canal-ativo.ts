/**
 * Canal ativo com o cliente (plano do dono, 22/10/2026, etapa 3; colunas da
 * migration 343): por onde o cliente está falando AGORA, e por onde a próxima
 * mensagem automática sai. O cliente escreveu no WhatsApp: whatsapp. Respondeu
 * o e-mail do ticket: email. Trocou de canal, troca a coluna.
 *
 * Grava em quotes.conversation_channel e jobs.conversation_channel das
 * oportunidades ABERTAS daquela conversa (quote ainda não fechada, job ainda
 * não concluído). Só vale para conta com regras.v2; sem PROCESSOS_V2=on a
 * função nem lê o banco.
 *
 * Quem chama:
 *   motor.ts (WhatsApp, depois da trava da mensagem repetida)  → whatsapp
 *   followup-quotes.ts (resposta do cliente por e-mail no ticket) → email
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { processoDaConta, processosV2Ligado } from "@/lib/processo/conta";
import { contaDaQuote } from "@/lib/processo/quote";

export type CanalAtivo = "email" | "whatsapp";

export type AlvoDoCanal = { quoteId?: string | null; jobId?: string | null; telefone?: string | null; ticketId?: number | string | null };

/** Quote ainda em conversa com o cliente. */
export const STATUS_DE_QUOTE_ABERTA = ["draft", "in_survey", "bidding", "quote_ready", "awaiting_customer", "awaiting_payment"] as const;
/** Job fechado não muda de canal. */
export const STATUS_DE_JOB_FECHADO = ["completed", "cancelled", "deleted"] as const;

/** O canal gravado, se for um dos dois; qualquer outra coisa é "não sei" (null). */
export function canalAtivo(linha: { conversation_channel?: string | null } | null | undefined): CanalAtivo | null {
  const c = String(linha?.conversation_channel ?? "").trim().toLowerCase();
  return c === "email" || c === "whatsapp" ? c : null;
}

/** Precisa gravar? Só quando muda (evita escrita a cada mensagem). */
export function canalMudou(atual: string | null | undefined, novo: CanalAtivo): boolean {
  return canalAtivo({ conversation_channel: atual }) !== novo;
}

/**
 * Por onde a próxima mensagem automática sai. Sem canal ativo (null) vale o
 * comportamento de sempre: todos os canais que quem chama já usaria.
 */
export function canaisParaEnviar(ativo: CanalAtivo | null, disponiveis: readonly CanalAtivo[]): CanalAtivo[] {
  if (!ativo) return [...disponiveis];
  return disponiveis.includes(ativo) ? [ativo] : [];
}

/** O canal ativo da quote, pelo banco. */
export async function canalAtivoDaQuote(sb: SupabaseClient, quoteId: string | null | undefined): Promise<CanalAtivo | null> {
  if (!quoteId) return null;
  const { data } = await sb.from("quotes").select("conversation_channel").eq("id", quoteId).maybeSingle<{ conversation_channel: string | null }>();
  return canalAtivo(data);
}

type QuoteDoCanal = { id: string; conversation_channel: string | null; source_account_id: string | null; client_id: string | null };
type JobDoCanal = { id: string; conversation_channel: string | null; account_id: string | null; client_id: string | null };

async function clientesDoTelefone(sb: SupabaseClient, telefone: string | null | undefined): Promise<string[]> {
  const digitos = String(telefone ?? "").replace(/\D/g, "");
  if (digitos.length < 9) return [];
  const { data } = await sb.from("clients").select("id").is("deleted_at", null).ilike("phone", `%${digitos.slice(-9)}%`).limit(10);
  return ((data ?? []) as Array<{ id: string }>).map((c) => c.id);
}

export type ResultadoDoCanal = { gravados: string[]; motivo?: string };

/**
 * Grava o canal ativo nas quotes e jobs abertos daquela conversa (gated por v2
 * da conta de cada um). Nunca lança: canal é rastro, não pode derrubar a mensagem.
 */
export async function registrarCanalAtivo(sb: SupabaseClient, alvo: AlvoDoCanal, canal: CanalAtivo): Promise<ResultadoDoCanal> {
  if (!processosV2Ligado()) return { gravados: [], motivo: "v2 off" };
  try {
    const quotes = new Map<string, QuoteDoCanal>();
    const jobs = new Map<string, JobDoCanal>();
    const colQ = "id, conversation_channel, source_account_id, client_id";
    const colJ = "id, conversation_channel, account_id, client_id";
    const addQ = (rs: unknown) => ((rs ?? []) as QuoteDoCanal[]).forEach((q) => quotes.set(q.id, q));
    const addJ = (rs: unknown) => ((rs ?? []) as JobDoCanal[]).forEach((j) => jobs.set(j.id, j));

    if (alvo.quoteId) addQ((await sb.from("quotes").select(colQ).eq("id", alvo.quoteId).in("status", [...STATUS_DE_QUOTE_ABERTA])).data);
    if (alvo.jobId) addJ((await sb.from("jobs").select(colJ).eq("id", alvo.jobId).not("status", "in", `(${STATUS_DE_JOB_FECHADO.join(",")})`)).data);
    if (alvo.ticketId) {
      const ref = String(alvo.ticketId);
      addQ((await sb.from("quotes").select(colQ).eq("external_source", "zendesk").eq("external_ref", ref).is("deleted_at", null).in("status", [...STATUS_DE_QUOTE_ABERTA])).data);
      addJ((await sb.from("jobs").select(colJ).eq("external_source", "zendesk").eq("external_ref", ref).not("status", "in", `(${STATUS_DE_JOB_FECHADO.join(",")})`)).data);
    }
    if (alvo.telefone) {
      const clientes = await clientesDoTelefone(sb, alvo.telefone);
      if (clientes.length) {
        addQ((await sb.from("quotes").select(colQ).in("client_id", clientes).is("deleted_at", null).in("status", [...STATUS_DE_QUOTE_ABERTA])).data);
        addJ((await sb.from("jobs").select(colJ).in("client_id", clientes).not("status", "in", `(${STATUS_DE_JOB_FECHADO.join(",")})`)).data);
      }
    }

    const v2DaConta = new Map<string, boolean>();
    const ehV2 = async (conta: string | null) => {
      if (!conta) return false;
      if (!v2DaConta.has(conta)) v2DaConta.set(conta, (await processoDaConta(sb, conta))?.v2 === true);
      return v2DaConta.get(conta)!;
    };

    const gravados: string[] = [];
    for (const q of quotes.values()) {
      if (!canalMudou(q.conversation_channel, canal)) continue;
      if (!(await ehV2(await contaDaQuote(sb, q)))) continue;
      const { error } = await sb.from("quotes").update({ conversation_channel: canal }).eq("id", q.id);
      if (!error) gravados.push(`quote:${q.id}`);
    }
    for (const j of jobs.values()) {
      if (!canalMudou(j.conversation_channel, canal)) continue;
      const conta = j.account_id ?? (await contaDaQuote(sb, { client_id: j.client_id }));
      if (!(await ehV2(conta))) continue;
      const { error } = await sb.from("jobs").update({ conversation_channel: canal }).eq("id", j.id);
      if (!error) gravados.push(`job:${j.id}`);
    }
    return { gravados };
  } catch (e) {
    return { gravados: [], motivo: e instanceof Error ? e.message : String(e) };
  }
}

/** Para o caminho do e-mail: o cliente respondeu no ticket por e-mail. */
export function clienteRespondeuPorEmail(sb: SupabaseClient, ticketId: number | string): Promise<ResultadoDoCanal> {
  return registrarCanalAtivo(sb, { ticketId }, "email");
}
