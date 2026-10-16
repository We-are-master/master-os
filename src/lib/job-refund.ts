/**
 * Refund de cliente no job (dono, 13/10/2026).
 *
 * O refund entra no razão que já existe (`job_payments`) como linha NEGATIVA de
 * cliente. Assim a fatura, o "amount due" do job e os painéis do Financeiro, que
 * somam essas linhas, já saem certos sem conhecer refund.
 *
 * Aqui ficam só as contas. Quem fala com a Stripe e com o banco é a rota.
 */
export const REFUND_NOTE_PREFIX = "Refund";

export type LedgerRow = { type: string; amount: number; note?: string | null; payment_method?: string | null };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function isRefundRow(p: { amount: number; note?: string | null }): boolean {
  return Number(p.amount) < 0 && String(p.note ?? "").startsWith(REFUND_NOTE_PREFIX);
}

/** O que o cliente pagou, já descontado o que voltou para ele. */
export function customerNetPaid(rows: LedgerRow[]): { deposit: number; final: number; total: number } {
  const sum = (t: string) => round2(rows.filter((r) => r.type === t).reduce((s, r) => s + Number(r.amount ?? 0), 0));
  const deposit = sum("customer_deposit");
  const final = sum("customer_final");
  return { deposit, final, total: round2(deposit + final) };
}

/**
 * De onde o refund sai: primeiro do saldo final, depois do sinal. Cada parte vira
 * uma linha negativa do mesmo tipo, para o job saber qual das duas voltou a faltar.
 */
export function splitRefundAcrossLedger(rows: LedgerRow[], amount: number): { type: "customer_final" | "customer_deposit"; amount: number }[] {
  const net = customerNetPaid(rows);
  const want = round2(amount);
  if (!(want > 0) || want > net.total + 0.005) return [];
  const fromFinal = round2(Math.min(Math.max(net.final, 0), want));
  const fromDeposit = round2(want - fromFinal);
  const out: { type: "customer_final" | "customer_deposit"; amount: number }[] = [];
  if (fromFinal > 0) out.push({ type: "customer_final", amount: fromFinal });
  if (fromDeposit > 0) out.push({ type: "customer_deposit", amount: fromDeposit });
  return out;
}

/** Cobranças de cartão deste job, pelas notas que o OS grava ao receber da Stripe. */
export function stripeRefsFromNotes(rows: LedgerRow[]): { paymentIntents: string[]; checkoutSessions: string[] } {
  const pis = new Set<string>();
  const sessions = new Set<string>();
  for (const r of rows) {
    if (Number(r.amount) <= 0) continue;
    const note = String(r.note ?? "");
    for (const m of note.matchAll(/\bpi_[A-Za-z0-9]+/g)) pis.add(m[0]);
    for (const m of note.matchAll(/\bcs_[A-Za-z0-9_]+/g)) sessions.add(m[0]);
  }
  return { paymentIntents: [...pis], checkoutSessions: [...sessions] };
}

/** Reparte o refund entre as cobranças de cartão, da mais recente para a mais antiga. */
export function planCardRefunds(charges: { paymentIntent: string; refundablePence: number }[], amountPence: number): { paymentIntent: string; pence: number }[] | null {
  let left = Math.round(amountPence);
  const plan: { paymentIntent: string; pence: number }[] = [];
  for (const c of charges) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, Math.round(c.refundablePence)));
    if (take > 0) plan.push({ paymentIntent: c.paymentIntent, pence: take });
    left -= take;
  }
  return left > 0 ? null : plan;
}

export function refundNote(opts: { method: "stripe" | "bank_transfer"; reason: string; stripeRefundId?: string; invoiceRef?: string | null }): string {
  const how = opts.method === "stripe" ? `to card${opts.stripeRefundId ? ` ${opts.stripeRefundId}` : ""}` : "by bank transfer";
  return [`${REFUND_NOTE_PREFIX} ${how}`, opts.invoiceRef?.trim() || null, opts.reason.trim()].filter(Boolean).join(" · ");
}
