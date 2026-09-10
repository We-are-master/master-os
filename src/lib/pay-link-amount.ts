/**
 * Quanto um link de pagamento cobra, quando o link pede um valor FIXO.
 *
 * O `/pay/REF` cobra o saldo inteiro e o `?pct=NN` cobra uma fatia dele. Falta
 * o caso do extra: "acabei de somar £50 de mão de obra a este job, manda o
 * link de £50". Porcentagem não serve aqui — a fatia se recalcula a cada
 * clique, e o saldo muda com pagamento e com outro extra, então a mesma URL
 * cobraria outro número amanhã.
 *
 * O teto é o saldo aberto, sempre. Um link não pode cobrar mais do que se deve,
 * mesmo que o valor pedido seja maior: se o cliente pagou parte no meio do
 * caminho, o link cobra o que restou e não o que estava escrito quando ele
 * nasceu.
 */

/** Mínimo que o cartão aceita. Abaixo disto o Stripe recusa a sessão. */
export const MINIMO_COBRAVEL_GBP = 0.3;

export type ValorDoLink =
  | { ok: true; valor: number; limitadoAoSaldo: boolean }
  | { ok: false; motivo: "sem_saldo" | "valor_invalido" | "abaixo_do_minimo" };

function centavo(v: number): number {
  return Math.round(v * 100) / 100;
}

export function valorFixoDoLink(pedido: unknown, saldoAberto: number): ValorDoLink {
  const saldo = centavo(Number(saldoAberto) || 0);
  if (!(saldo > 0)) return { ok: false, motivo: "sem_saldo" };

  const n = typeof pedido === "number" ? pedido : Number(String(pedido ?? "").replace(/[£,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return { ok: false, motivo: "valor_invalido" };

  const pedidoCent = centavo(n);
  const valor = Math.min(pedidoCent, saldo);
  if (valor < MINIMO_COBRAVEL_GBP) return { ok: false, motivo: "abaixo_do_minimo" };

  return { ok: true, valor, limitadoAoSaldo: pedidoCent > saldo };
}
