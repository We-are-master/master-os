/**
 * Quotes da Housekeep no v2 (plano do dono, 22/10/2026): o que ainda é só dela.
 *
 *   - lance viável chegou: processa NA HORA (não espera a janela de 2h das outras);
 *   - antes de qualquer envio automático do preço: se a equipe já mandou uma
 *     quote à mão (resposta pública com £), não processa.
 *
 * Sem lance, a régua é a mesma de toda quote desde 23/10/2026 (24h No Bids,
 * 48h "not able to quote" e fecha): processo/quote-sem-lance.ts.
 */

/** Marca em quotes.automation_status: a equipe mandou preço à mão, nada automático. */
export const HK_MARCA_EQUIPE_RESPONDEU = "housekeep_team_replied";

export type PassoDepoisDoHistorico = "processar" | "equipe_respondeu";

/** Lance viável chegou: só para quando a equipe já mandou preço à mão. */
export function passoDepoisDoHistorico(h: { respostaManual: boolean; respostaManualComPreco: boolean }): PassoDepoisDoHistorico {
  return h.respostaManualComPreco ? "equipe_respondeu" : "processar";
}
