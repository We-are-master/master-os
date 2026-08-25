/**
 * Lente de moeda do Pulse.
 *
 * Os componentes do Pulse formatam dinheiro em dezenas de lugares, dentro de
 * subcomponentes que não são consumidores de contexto. Em vez de espalhar um
 * hook por cada um deles, a moeda escolhida vive aqui, e as funções de formato
 * dos componentes passam a ler daqui.
 *
 * Regras que sustentam isso:
 *   - o dado continua em GBP em todo lugar. Isto é exibição, nunca conversão
 *     de valor guardado;
 *   - o provider (`PulseCurrencyProvider`) escreve a lente durante o render,
 *     antes de qualquer filho formatar;
 *   - a página remonta a subárvore quando a moeda muda, então ninguém fica com
 *     número velho na tela.
 */

export type PulseLensCurrency = "GBP" | "BRL";

let lensCurrency: PulseLensCurrency = "GBP";
let lensRate = 1;

export function setPulseMoneyLens(currency: PulseLensCurrency, rate: number): void {
  lensCurrency = currency;
  lensRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
}

export function pulseLensCurrency(): PulseLensCurrency {
  return lensCurrency;
}

/** Formata um valor **em GBP** na moeda da lente, sem casas decimais. */
export function pulseMoney(gbp: number): string {
  const n = Number.isFinite(gbp) ? gbp : 0;
  if (lensCurrency === "BRL") {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    }).format(n * lensRate);
  }
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Versão com centavos, para onde o Pulse mostra valor exato. */
export function pulseMoneyPrecise(gbp: number): string {
  const n = Number.isFinite(gbp) ? gbp : 0;
  if (lensCurrency === "BRL") {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n * lensRate);
  }
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

/** "£12.4k" / "R$ 87k" — mesma compactação que o Pulse já usava. */
export function pulseMoneyCompact(gbp: number): string {
  const value = lensCurrency === "BRL" ? gbp * lensRate : gbp;
  const symbol = lensCurrency === "BRL" ? "R$ " : "£";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${symbol}${(value / 1_000).toFixed(1)}k`;
  return `${symbol}${Math.round(value)}`;
}
