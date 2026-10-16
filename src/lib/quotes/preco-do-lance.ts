/**
 * Uma regra só para o preço que sai de um lance de parceiro (dono, 16/10/2026).
 *
 * Havia três: proposta por lance (30%, até £600), varredura de lances (40%, até £1001)
 * e a cotação automática do Harvey (30%, até £600). Ficou a mais nova do dono (09/10):
 * margem mínima de 30%, arredondado para cima de £5, envio automático até £600.
 * Mudar aqui muda os três caminhos. Puro de propósito: sem banco, para teste e para o
 * navegador.
 */
export const MARGEM_DO_LANCE = 0.3;

/** Teto do envio automático ao cliente, em £. `HARVEY_BID_AUTO_MAX_GBP` ainda manda, se existir. */
export function limiteDoEnvioAutomatico(): number {
  const n = Number(process.env.HARVEY_BID_AUTO_MAX_GBP?.trim() || process.env.HARVEY_QUOTE_AUTO_MAX?.trim() || "600");
  return Number.isFinite(n) && n > 0 ? n : 600;
}

export function precoDeVendaDoLance(custo: number, margem = MARGEM_DO_LANCE): number {
  return Math.ceil(custo / (1 - margem) / 5) * 5;
}
