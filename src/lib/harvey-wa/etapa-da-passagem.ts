/**
 * Em que etapa do funil o ticket fica quando o Harvey passa a conversa para a equipe
 * (dono, 12/10/2026: "ele recomenda call, deveria ter colocado nesse status").
 *
 *   call  -> 📞 To Call      o cliente pediu ligação ou quer falar com uma pessoa
 *   quote -> 📝 Needs Quote  falta uma pessoa dar o preço (elétrica, gás, fora da tabela)
 *   null  -> o ticket fica onde está (reclamação, transferência, reserva existente)
 *
 * O Harvey diz o que precisa em `need`. O motivo escrito é a segunda prova: modelo que
 * esquece o campo ainda cai na etapa certa quando o texto é claro.
 */
export type EtapaDaPassagem = "call" | "quote" | null;

const PEDE_LIGACAO = /\bcall(?:ed|s)?\s*(?:me\s*)?back\b|\bcallback\b|\b(?:phone|give (?:me|you|them|him|her) a|wants? a|asked for a|needs? a|requested a) call\b|\bring (?:me|them|him|her)\b/i;
const PEDE_PRECO = /\bquot(?:e|ed|ing)\b|\bprice\b|\bpricing\b|\belectric(?:al|ian)?\b|\bgas\b|outside (?:the )?(?:catalogue|price list)/i;
const NAO_E_VENDA = /\bcomplain|\bconcern|\brefund|\bbank transfer|\bexisting booking|\breschedul|\bcancel/i;

export function etapaDaPassagem(need: unknown, motivo: string | null | undefined): EtapaDaPassagem {
  const texto = String(motivo ?? "");
  if (need === "call") return "call";
  if (need === "quote") return "quote";
  if (need === "other") return null;
  if (PEDE_LIGACAO.test(texto)) return "call";
  if (NAO_E_VENDA.test(texto)) return null;
  if (PEDE_PRECO.test(texto)) return "quote";
  return null;
}
