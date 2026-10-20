/**
 * Pedir ajuda de verdade (B4, dono 20/10/2026: "ele ask for help quando quiser em action
 * required"). O Harvey para, faz UMA pergunta clara no ticket e continua sozinho com a
 * resposta da equipe numa nota interna:
 *
 *   #harvey send        manda a cotação como está (ignora o teto de envio)
 *   #harvey price 1400  manda a cotação por £1.400
 *   #harvey stop        o Harvey sai deste ticket (tag harvey_off)
 *
 * O ticket fica com a tag `harvey_ajuda` enquanto espera; respondido, a tag sai.
 * `harvey_off` é respeitada por quem fala com cliente (ponte-cliente-parceiro, varredura de
 * lances, quoter, aceite escrito).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { addTicketTags, removeTicketTags, zendeskApi } from "@/lib/zendesk";
import { precisaDeAcao } from "@/lib/fila-de-acao";

export const TAG_AJUDA = "harvey_ajuda";
export const TAG_OFF = "harvey_off";
const MARCA_DA_PERGUNTA = "HARVEY needs your call";

export type Comando = { acao: "send" } | { acao: "price"; valor: number } | { acao: "stop" };

/** Lê "#harvey send / price 1400 / stop" (aceita "£1,400", "1400.50"). Outra coisa: null. */
export function lerComando(texto: string): Comando | null {
  const t = String(texto ?? "").trim().toLowerCase();
  const m = t.match(/^#harvey\s+(send|stop|price)\b\s*(.*)$/);
  if (!m) return null;
  if (m[1] === "send") return { acao: "send" };
  if (m[1] === "stop") return { acao: "stop" };
  const n = Number(m[2].replace(/[£,\s]/g, "").match(/^\d+(\.\d{1,2})?/)?.[0]);
  return Number.isFinite(n) && n > 0 ? { acao: "price", valor: Math.round(n * 100) / 100 } : null;
}

/** O Harvey para e pergunta: nota com as opções, Action Required e a tag de espera. */
export async function pedirAjuda(
  ticketId: number,
  pergunta: string,
  postarNotaInterna: (ticketId: number, corpo: string) => Promise<void>,
): Promise<void> {
  await postarNotaInterna(
    ticketId,
    [
      `🤖 ${MARCA_DA_PERGUNTA}: ${pergunta}`,
      "",
      "Reply with an internal note and I carry on from there:",
      "#harvey send   (send the quote as it is)",
      "#harvey price 1400   (send it at £1,400)",
      "#harvey stop   (I leave this ticket to you)",
    ].join("\n"),
  );
  await addTicketTags(ticketId, [TAG_AJUDA]).catch(() => null);
  await precisaDeAcao(ticketId, `Harvey needs your call: ${pergunta.slice(0, 200)}`).catch(() => null);
}

type Comentario = { id: number; public: boolean; body?: string; plain_body?: string; created_at: string };

/**
 * A cada ciclo: tickets esperando a equipe (`harvey_ajuda`) que já têm "#harvey ..." numa
 * nota interna depois da pergunta. Faz o que a nota pede e tira a tag.
 */
export async function lerComandosDaEquipe(
  sb: SupabaseClient,
  postarNotaInterna: (ticketId: number, corpo: string) => Promise<void>,
): Promise<string[]> {
  const out: string[] = [];
  const busca = await zendeskApi<{ results?: Array<{ id: number }> }>(
    `search.json?query=${encodeURIComponent(`type:ticket tags:${TAG_AJUDA} -status:solved -status:closed`)}`,
  ).catch(() => ({ results: [] }));
  for (const { id: ticketId } of (busca.results ?? []).slice(0, 20)) {
    const { comments } = await zendeskApi<{ comments: Comentario[] }>(`tickets/${ticketId}/comments.json?sort_order=desc&per_page=30`).catch(() => ({ comments: [] as Comentario[] }));
    const texto = (c: Comentario) => (c.plain_body ?? c.body ?? "").trim();
    const iPergunta = (comments ?? []).findIndex((c) => !c.public && texto(c).includes(MARCA_DA_PERGUNTA));
    if (iPergunta < 0) continue;
    // Mais novo primeiro: só vale o comando escrito depois da pergunta.
    const ordem = (comments ?? []).slice(0, iPergunta).find((c) => !c.public && lerComando(texto(c)));
    if (!ordem) continue;
    const comando = lerComando(texto(ordem))!;

    let linha: string;
    if (comando.acao === "stop") {
      await addTicketTags(ticketId, [TAG_OFF]).catch(() => null);
      linha = "OK, I've stepped out of this ticket (harvey_off). It's all yours.";
    } else {
      const { data: q } = await sb
        .from("quotes")
        .select("id, reference, status")
        .eq("external_source", "zendesk")
        .eq("external_ref", String(ticketId))
        .in("status", ["quote_ready", "bidding"])
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!q) {
        linha = "I couldn't find a priced quote on this ticket to send. Send it from Quotes.";
      } else {
        const { enviarQuotePelaEquipe } = await import("@/lib/quote-lances-sweep");
        const r = await enviarQuotePelaEquipe(sb, (q as { id: string }).id, comando.acao === "price" ? comando.valor : null, postarNotaInterna);
        linha = r.enviado ? `Done: ${r.linha}` : `Not sent: ${r.linha}. Send it from Quotes.`;
      }
    }
    await removeTicketTags(ticketId, [TAG_AJUDA]).catch(() => null);
    await postarNotaInterna(ticketId, `🤖 HARVEY — got "${texto(ordem).slice(0, 60)}". ${linha}`).catch(() => null);
    out.push(`#${ticketId}: ${comando.acao} → ${linha}`);
  }
  return out;
}
