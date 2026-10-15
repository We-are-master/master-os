/**
 * A fila de ação (dono, 15/10/2026): o único lugar que liga e desliga o campo
 * "Action Required" do Zendesk (tagger 6437659168543, ao lado do Reply Status).
 *
 *   Reply Status 🔴/🟢  alguém escreveu e espera resposta
 *   Action Required     há uma ação NOSSA além de responder (cotar, decidir, cobrar)
 *
 * O ticket sai da view ⚡ Action Required só com Reply Status 🟢 E Action Required No.
 *
 *   precisaDeAcao  → Yes + nota interna de uma linha "⚡ Action Required: <próxima ação>"
 *   acaoFeita      → No (+ nota curta opcional)
 *
 * Nunca lança: loga e devolve o resultado. Ticket "AI agent" (o Harvey atendendo no
 * WhatsApp, só leitura) vai pela reserva de sempre (`notaComReserva`): escreve no
 * ticket do lead da mesma pessoa. Tags antigas (harvey_no_bids, side_awaiting)
 * continuam com quem já as põe; aqui é só o campo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getZendeskTicketId, isZendeskConfigured, zendeskApi } from "@/lib/zendesk";

export const ACTION_REQUIRED_FIELD_ID = Number(process.env.ZENDESK_ACTION_REQUIRED_FIELD_ID?.trim() || "6437659168543");
export const ACTION_REQUIRED_YES = "action_required_yes";
export const ACTION_REQUIRED_NO = "action_required_no";

/** A mesma ação anotada há menos que isso não ganha outra nota. */
const JANELA_SEM_REPETIR_H = 24;
const PREFIXO = "⚡ Action Required:";

export type ResultadoDaFila = { ok: boolean; ticketId: number | null; linha: string };

// ─── Partes puras ───────────────────────────────────────────────────────────

/** A nota de uma linha: espaço colapsado, sem o prefixo repetido, até 280 caracteres. */
export function notaDaAcao(proximaAcao: string): string {
  const limpa = proximaAcao.replace(/\s+/g, " ").replace(/^⚡?\s*action required:\s*/i, "").trim() || "check this ticket";
  return `${PREFIXO} ${limpa.length > 280 ? `${limpa.slice(0, 277)}...` : limpa}`;
}

/** Valor atual do campo no ticket (null = vazio). */
export function valorDoCampo(campos: Array<{ id: number; value: unknown }> | undefined, fieldId = ACTION_REQUIRED_FIELD_ID): string | null {
  const v = campos?.find((f) => Number(f.id) === fieldId)?.value;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

type ComentarioLido = { body?: string | null; plain_body?: string | null; created_at?: string | null; public?: boolean };

/** A mesma nota já está no ticket, interna e recente? (a reserva prefixa o texto, então vale "contém") */
export function jaAnotado(comentarios: ComentarioLido[], nota: string, agora: Date = new Date(), janelaHoras = JANELA_SEM_REPETIR_H): boolean {
  const limite = agora.getTime() - janelaHoras * 3_600_000;
  return comentarios.some((c) => {
    if (c.public) return false;
    const quando = Date.parse(c.created_at ?? "");
    if (!Number.isFinite(quando) || quando < limite) return false;
    const corpo = (c.plain_body ?? c.body ?? "").replace(/\s+/g, " ");
    return corpo.includes(nota);
  });
}

/** O que fazer com o pedido de Yes, dado o que o ticket já tem. */
export function passoDoSim(a: { status: string | null; valorAtual: string | null; jaTemANota: boolean }): "fechado" | "nada" | "escrever" {
  if (a.status === "closed") return "fechado";
  if (a.valorAtual === ACTION_REQUIRED_YES && a.jaTemANota) return "nada";
  return "escrever";
}

/** O que fazer com o pedido de No. */
export function passoDoNao(a: { status: string | null; valorAtual: string | null; temNota: boolean }): "fechado" | "nada" | "escrever" {
  if (a.status === "closed") return "fechado";
  if (a.valorAtual === ACTION_REQUIRED_NO && !a.temNota) return "nada";
  return "escrever";
}

// ─── Zendesk ────────────────────────────────────────────────────────────────

type TicketLido = { status: string | null; support_type?: string; custom_fields?: Array<{ id: number; value: unknown }> };

async function lerTicket(id: number): Promise<TicketLido | null> {
  const { ticket } = await zendeskApi<{ ticket?: TicketLido }>(`tickets/${id}.json`);
  return ticket ?? null;
}

function idValido(ticketId: number | string | null | undefined): number | null {
  const n = Number(String(ticketId ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function escreverComReserva(id: number, valor: string, nota: string | null): Promise<void> {
  const postar = async (alvo: number, corpo: string) => {
    await zendeskApi(`tickets/${alvo}.json`, {
      method: "PUT",
      body: { ticket: { custom_fields: [{ id: ACTION_REQUIRED_FIELD_ID, value: valor }], ...(corpo.trim() ? { comment: { public: false, body: corpo } } : {}) } },
    });
  };
  if (!nota) return postar(id, "");
  // Ticket "AI agent" recusa a escrita: a reserva manda para o ticket do lead da mesma pessoa.
  const { notaComReserva } = await import("@/lib/harvey-wa/zendesk-wa");
  return notaComReserva(postar)(id, nota);
}

/**
 * Liga o Action Required: há uma ação nossa. `proximaAcao` é o que a pessoa tem de
 * fazer, em inglês e numa linha ("No bids after 26h: invite more partners or call").
 * `esperarAgente`: o ticket acabou de sair do Harvey e pode levar uns segundos para
 * deixar de ser "AI agent".
 */
export async function precisaDeAcao(ticketId: number | string | null | undefined, proximaAcao: string, opts: { esperarAgente?: boolean } = {}): Promise<ResultadoDaFila> {
  const id = idValido(ticketId);
  if (!id) return { ok: false, ticketId: null, linha: "sem ticket" };
  if (!isZendeskConfigured()) return { ok: false, ticketId: id, linha: "Zendesk não configurado" };
  const nota = notaDaAcao(proximaAcao);
  try {
    let t = await lerTicket(id);
    for (let espera = 0; opts.esperarAgente && espera < 6 && t?.support_type === "ai_agent"; espera++) {
      await new Promise((r) => setTimeout(r, 2500));
      t = await lerTicket(id);
    }
    const valorAtual = valorDoCampo(t?.custom_fields);
    let jaTemANota = false;
    if (valorAtual === ACTION_REQUIRED_YES) {
      const { comments } = await zendeskApi<{ comments?: ComentarioLido[] }>(`tickets/${id}/comments.json?sort_order=desc&per_page=15`).catch(() => ({ comments: [] as ComentarioLido[] }));
      jaTemANota = jaAnotado(comments ?? [], nota);
    }
    const passo = passoDoSim({ status: t?.status ?? null, valorAtual, jaTemANota });
    if (passo === "fechado") return { ok: false, ticketId: id, linha: `#${id} fechado, não marco` };
    if (passo === "nada") return { ok: true, ticketId: id, linha: `#${id} já estava em Action Required com a mesma ação` };
    await escreverComReserva(id, ACTION_REQUIRED_YES, nota);
    return { ok: true, ticketId: id, linha: `#${id} → Action Required: ${nota.slice(PREFIXO.length + 1, PREFIXO.length + 81)}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 160) : String(e);
    console.error("[fila-de-acao] precisaDeAcao", id, msg);
    return { ok: false, ticketId: id, linha: `#${id} Action Required falhou: ${msg}` };
  }
}

/**
 * Desliga o Action Required: a ação nossa foi feita (quote enviada, final check
 * aprovado, pago). Não mexe no Reply Status: quem chama decide isso.
 */
export async function acaoFeita(ticketId: number | string | null | undefined, oQueFoiFeito?: string | null): Promise<ResultadoDaFila> {
  const id = idValido(ticketId);
  if (!id) return { ok: false, ticketId: null, linha: "sem ticket" };
  if (!isZendeskConfigured()) return { ok: false, ticketId: id, linha: "Zendesk não configurado" };
  const nota = oQueFoiFeito?.replace(/\s+/g, " ").trim() ? `✅ Done: ${oQueFoiFeito.replace(/\s+/g, " ").trim().slice(0, 280)}` : null;
  try {
    const t = await lerTicket(id);
    const passo = passoDoNao({ status: t?.status ?? null, valorAtual: valorDoCampo(t?.custom_fields), temNota: !!nota });
    if (passo === "fechado") return { ok: false, ticketId: id, linha: `#${id} fechado` };
    if (passo === "nada") return { ok: true, ticketId: id, linha: `#${id} já estava sem ação` };
    // Ticket do Harvey (só leitura) sem nota: não há onde escrever o campo; o do lead fica como está.
    if (t?.support_type === "ai_agent" && !nota) return { ok: true, ticketId: id, linha: `#${id} com o Harvey (só leitura), campo não mexido` };
    await escreverComReserva(id, ACTION_REQUIRED_NO, nota);
    return { ok: true, ticketId: id, linha: `#${id} → sem ação` };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 160) : String(e);
    console.error("[fila-de-acao] acaoFeita", id, msg);
    return { ok: false, ticketId: id, linha: `#${id} limpar Action Required falhou: ${msg}` };
  }
}

/**
 * Pago e fechado: "cobrar" deixa de ser ação nossa. Só para o servidor (webhook do
 * Stripe, link de pagamento, nova tentativa no cartão); a marcação manual na tela de
 * Finance roda no navegador e fica de fora (o ticket vai a Solved pelo status do job).
 */
export async function jobPagoSemAcao(sb: SupabaseClient, ref: { jobId?: string | null; invoiceId?: string | null }): Promise<ResultadoDaFila | null> {
  try {
    type JobLido = { id: string; reference: string | null; status: string | null; external_source: string | null; external_ref: string | null };
    const campos = "id, reference, status, external_source, external_ref";
    const porCampo = async (coluna: string, valor: string): Promise<JobLido | null> =>
      ((await sb.from("jobs").select(campos).eq(coluna, valor).maybeSingle()).data as JobLido | null) ?? null;
    let job: JobLido | null = ref.jobId ? await porCampo("id", ref.jobId) : null;
    if (!job && ref.invoiceId) {
      job = await porCampo("invoice_id", ref.invoiceId);
      if (!job) {
        const { data: inv } = await sb.from("invoices").select("job_reference").eq("id", ref.invoiceId).maybeSingle();
        const jr = (inv as { job_reference?: string | null } | null)?.job_reference?.trim();
        if (jr) job = await porCampo("reference", jr);
      }
    }
    if (!job || job.status !== "completed") return null;
    const ticketId = getZendeskTicketId(job);
    return ticketId ? await acaoFeita(ticketId) : null;
  } catch (e) {
    console.error("[fila-de-acao] jobPagoSemAcao", e instanceof Error ? e.message : e);
    return null;
  }
}
