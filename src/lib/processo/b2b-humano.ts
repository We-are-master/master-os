/**
 * B2B só com gente (plano do dono, 22/10/2026, etapa D).
 *
 * Conta v2 com `conducaoDaQuote === "humana"`: o pedido que chega por e-mail é
 * registrado (quote no OS, como hoje), o cliente recebe o "we're working on it"
 * uma vez, e o ticket vai para Action Required com o motivo "Human Review
 * Required". Nada mais acontece sozinho: nenhum parceiro é convidado, trabalho
 * por hora não é aceito, nenhuma pergunta de informação faltando sai, e a
 * varredura da cotação automática não pega o ticket.
 *
 * Quem decide cotar com parceiros é a equipe, pela macro "Get partner quotes"
 * do Zendesk (tag `b2b_cotar`, ver b2b-cotar.ts). Mesmo aí a quote para em
 * Ready to send: o envio ao cliente é decisão de gente.
 *
 * Fora do v2 (ou conta sem leitura) tudo segue como antes: `planoDoPedido(null)`
 * devolve o plano de hoje.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { processoDaConta, type RegrasDoProcesso } from "./conta";
import { ROTULO_DO_MOTIVO } from "@/lib/pendencias/motivos";

/** Carimbada no ticket quando ele para para revisão humana. A varredura automática respeita. */
export const TAG_REVISAO_HUMANA = "b2b_human_review";
/** Posta pela macro "Get partner quotes": acorda o Harvey neste ticket. */
export const TAG_B2B_COTAR = "b2b_cotar";
/** O Harvey já atendeu a macro neste ticket (trava de uma vez só). */
export const TAG_B2B_COTADO = "b2b_cotado";

/** O texto que entra no campo Action Required (o rótulo é o mesmo da fila do OS). */
export const MOTIVO_REVISAO_HUMANA = ROTULO_DO_MOTIVO.human_review_required;

export function ehB2bSoHumano(regras: Pick<RegrasDoProcesso, "v2" | "conducaoDaQuote"> | null | undefined): boolean {
  return regras?.v2 === true && regras.conducaoDaQuote === "humana";
}

export type PlanoDoPedido = {
  /** O pedido para para gente olhar (Action Required "Human Review Required"). */
  revisaoHumana: boolean;
  /** A quote do OS nasce pronta para transmitir (bidding) quando o resto deixa. */
  transmitir: boolean;
  convidarParceiros: boolean;
  aceitarHora: boolean;
  pedirInfo: boolean;
  /** O aviso "we're working on it" sai mesmo com HARVEY_QUOTE_ACK desligado (ainda uma vez só). */
  avisoSempre: boolean;
};

/** O que o quoter faz com um pedido por e-mail, dado o processo da conta. */
export function planoDoPedido(regras: Pick<RegrasDoProcesso, "v2" | "conducaoDaQuote"> | null | undefined): PlanoDoPedido {
  if (ehB2bSoHumano(regras)) {
    return { revisaoHumana: true, transmitir: false, convidarParceiros: false, aceitarHora: false, pedirInfo: false, avisoSempre: true };
  }
  return { revisaoHumana: false, transmitir: true, convidarParceiros: true, aceitarHora: true, pedirInfo: true, avisoSempre: false };
}

/** A linha de uma frase que vai no Action Required do ticket. */
export function proximaAcaoDaRevisao(quoteRef: string | null): string {
  return `${MOTIVO_REVISAO_HUMANA}: B2B request${quoteRef ? ` registered as ${quoteRef}` : " received"}. Review it, then use the "Get partner quotes" macro or price it in-house.`;
}

/**
 * A varredura da cotação automática (varredura-cotacao-automatica.ts) não toca
 * neste ticket? Vale a tag (o caminho normal) ou o processo da conta da quote
 * (para quando a tag não chegou a ser gravada).
 */
export function foraDaCotacaoAutomatica(tags: readonly string[], regrasDaQuote?: Pick<RegrasDoProcesso, "v2" | "conducaoDaQuote"> | null): boolean {
  if (tags.includes(TAG_REVISAO_HUMANA) || tags.includes(TAG_B2B_COTAR) || tags.includes(TAG_B2B_COTADO)) return true;
  return ehB2bSoHumano(regrasDaQuote);
}

/**
 * Para o integrador do envio automático (quote-lances-sweep.ts / quote-envio-automatico.ts):
 * a quote desta conta para em Ready to send e não sai sozinha ao cliente.
 */
export async function quoteSoComGente(sb: SupabaseClient, contaDaQuote: string | null | undefined): Promise<boolean> {
  if (!contaDaQuote) return false;
  return ehB2bSoHumano(await processoDaConta(sb, contaDaQuote).catch(() => null));
}
