/**
 * Em que etapa do funil o ticket fica quando o Harvey passa a conversa para a equipe
 * (dono, 12/10/2026: "ele recomenda call, deveria ter colocado nesse status").
 *
 *   call      -> 📞 To Call      o cliente pediu ligação ou quer falar com uma pessoa
 *   quote     -> 📝 Needs Quote  falta uma pessoa dar o preço (elétrica, gás, fora da tabela)
 *   complaint -> 🚨 Complaint    reclamação, serviço mal feito, reembolso: vai para o Leo
 *   booking   -> fica onde está, mas vai para o Leo (reserva existente, remarcar, cancelar, transferência)
 *   null      -> o ticket fica onde está
 *
 * Dono, 15/10/2026: tudo entra New/Open e alguém classifica, e o Harvey conta como
 * alguém. Reclamação e assunto de operação são do Leo (Needs Attention, tag com_leo).
 *
 * O Harvey diz o que precisa em `need`. O motivo escrito é a segunda prova: modelo que
 * esquece o campo ainda cai na etapa certa quando o texto é claro.
 */
export type EtapaDaPassagem = "call" | "quote" | "complaint" | "booking" | null;

const PEDE_LIGACAO = /\bcall(?:ed|s)?\s*(?:me\s*)?back\b|\bcallback\b|\b(?:phone|give (?:me|you|them|him|her) a|wants? a|asked for a|needs? a|requested a) call\b|\bring (?:me|them|him|her)\b/i;
const PEDE_PRECO = /\bquot(?:e|ed|ing)\b|\bprice\b|\bpricing\b|\belectric(?:al|ian)?\b|\bgas\b|outside (?:the )?(?:catalogue|price list)/i;
const RECLAMACAO = /\bcomplain|\bunhappy|\bnot happy|\brefund|\bpoor (?:job|work|service)|\bdamage(?:d)? (?:by|during)|\bdid(?:n't| not) (?:turn up|show|finish|do)/i;
const OPERACAO = /\bbank transfer|\bexisting booking|\breschedul|\bcancel|\bwho is coming|\bwhat time (?:is|will)/i;
const NAO_E_VENDA = /\bconcern/i;

export function etapaDaPassagem(need: unknown, motivo: string | null | undefined): EtapaDaPassagem {
  const texto = String(motivo ?? "");
  if (need === "call") return "call";
  if (need === "quote") return "quote";
  if (need === "complaint") return "complaint";
  if (need === "booking") return "booking";
  if (RECLAMACAO.test(texto)) return "complaint";
  if (OPERACAO.test(texto)) return "booking";
  if (need === "other") return null;
  if (PEDE_LIGACAO.test(texto)) return "call";
  if (NAO_E_VENDA.test(texto)) return null;
  if (PEDE_PRECO.test(texto)) return "quote";
  return null;
}

const PROXIMA_ACAO: Record<string, string> = {
  call: "call the customer",
  quote: "price this job",
  complaint: "complaint, Leo to handle",
  booking: "existing booking, Leo to handle",
};

/** A linha da fila de ação (fila-de-acao.ts) quando o Harvey passa: o que fazer e o motivo dele. */
export function textoDaPassagem(need: unknown, motivo: string | null | undefined): string {
  const etapa = etapaDaPassagem(need, motivo);
  const porque = String(motivo ?? "").replace(/\s+/g, " ").trim();
  return `Harvey handed over (${etapa ? PROXIMA_ACAO[etapa] : "pick up the chat"})${porque ? `: ${porque}` : ""}`;
}
