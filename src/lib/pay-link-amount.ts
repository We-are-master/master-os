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

const EPS = 0.02;

/**
 * Saldo que o `/pay/REF` cobra, com o total do job como rede de segurança.
 *
 * A base é o saldo da fatura (amount − amount_paid). Só que a fatura pode ter o
 * `amount` errado para baixo: em 14/10/2026 a RCP-2026-917 (job de £180) ficou com
 * amount = 90 depois do sinal de £90, e o link do saldo achou que não havia nada a
 * cobrar e mandou o cliente direto para a tela de "pago".
 *
 * Quando a fatura é a ÚNICA do job e vale menos que o total do job (preço + extras −
 * promoção), o saldo passa a ser o total do job menos o que já entrou (o maior entre o
 * pago na fatura e o razão do job). Fica com o maior dos dois saldos: fatura maior que
 * o job (CCZ, estacionamento ainda fora do job) continua cobrando o que a fatura diz.
 *
 * Job com fatura de sinal e fatura de saldo separadas (quote aceito) não entra aqui:
 * cada fatura cobra a sua fatia.
 *
 * Fatura marcada como paga conta como paga por inteiro mesmo sem `amount_paid` (linha
 * legada marcada à mão): o guarda nunca volta a cobrar o que o Financeiro deu baixa.
 */
export function saldoDoLinkDePagamento(input: {
  valorFatura: number;
  pagoFatura: number;
  faturaPaga?: boolean;
  /** Preço + extras − promoção do job; null quando a fatura não tem job. */
  totalDoJob?: number | null;
  /** Soma dos pagamentos de cliente no razão do job; null quando não deu para ler. */
  pagoNoJob?: number | null;
  faturaUnicaDoJob?: boolean;
}): number {
  const valor = centavo(Math.max(0, Number(input.valorFatura) || 0));
  const pagoLinha = centavo(Math.max(0, Number(input.pagoFatura) || 0));
  const pagoFatura = input.faturaPaga ? Math.max(pagoLinha, valor) : pagoLinha;
  const saldoFatura = Math.max(0, centavo(valor - pagoFatura));

  const totalJob = centavo(Number(input.totalDoJob ?? 0) || 0);
  if (!input.faturaUnicaDoJob || !(totalJob > valor + EPS)) return saldoFatura;

  const pagoJob = Math.max(pagoFatura, centavo(Number(input.pagoNoJob ?? 0) || 0));
  const saldoJob = Math.max(0, centavo(totalJob - pagoJob));
  return Math.max(saldoFatura, saldoJob);
}
