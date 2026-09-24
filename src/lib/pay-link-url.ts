/**
 * Stable OS pay link for an invoice: `/pay/RCP-XXXX` (full balance) or
 * `/pay/RCP-XXXX?pct=50` (percentage of the open balance, e.g. a deposit).
 *
 * The amount is computed when the client clicks, not when the link is created,
 * so the same URL stays correct after the job value changes or a partial
 * payment lands. Client-safe: no Stripe import here.
 */
const PAY_LINK_BASE =
  process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") ||
  "https://app.getfixfy.com";

export function invoicePayLinkUrl(reference: string, pct?: number): string {
  const ref = encodeURIComponent(reference.trim());
  const p = Math.round(Number(pct));
  const suffix = Number.isFinite(p) && p >= 1 && p <= 99 ? `?pct=${p}` : "";
  return `${PAY_LINK_BASE}/pay/${ref}${suffix}`;
}

/**
 * Link de um valor FIXO na fatura: `/pay/RCP-XXXX?amount=50.00`.
 *
 * Para cobrar um extra recém-lançado. Diferente do `pct`, que se recalcula a
 * cada clique, aqui o número é o que está escrito — limitado ao saldo aberto no
 * momento do clique, para nunca cobrar mais do que se deve.
 */
export function invoicePayLinkForAmount(reference: string, amountGbp: number): string | null {
  const ref = reference.trim();
  const valor = Math.round(Number(amountGbp) * 100) / 100;
  if (!ref || !Number.isFinite(valor) || valor <= 0) return null;
  return `${PAY_LINK_BASE}/pay/${encodeURIComponent(ref)}?amount=${valor.toFixed(2)}`;
}

/**
 * Link que o cliente deve receber para uma fatura, a partir do que está gravado.
 *
 * Até 24/09/2026 a Vercel rodava com a chave de TESTE da Stripe, e o aceite de
 * quote gravava na fatura um Payment Link fixo (`buy.stripe.com/test_...`) que
 * abre em Sandbox para sempre: cartão real é recusado. Esses links continuam no
 * banco, então quem lê `stripe_payment_link_url` passa por aqui e recebe o
 * `/pay/REF`, que cria a sessão na hora com a chave atual.
 *
 * Link vazio continua vazio: fatura sem link é decisão de quem a gravou.
 */
export function invoicePayLinkForClient(
  reference: string | null | undefined,
  storedUrl: string | null | undefined,
): string {
  const url = storedUrl?.trim() ?? "";
  if (!url) return "";
  if (isStripeTestLink(url) && reference?.trim()) return invoicePayLinkUrl(reference);
  return url;
}

export function isStripeTestLink(url: string): boolean {
  return /^https:\/\/(buy|checkout)\.stripe\.com\/(c\/pay\/cs_)?test_/i.test(url.trim());
}
