/**
 * O que cada fatura do job é, na tela (dono, 20/10/2026, JOB-9773: "duplicou valor a cobrar").
 *
 * Cotação aceita com sinal gera DUAS faturas: o sinal (paga agora) e o saldo (depois do job).
 * As duas apareciam como "Client invoice", com o mesmo valor e o mesmo vencimento, e pareciam
 * cobrança em dobro. Agora cada uma diz o que é e quando vence.
 */

export type FaturaParaRotulo = { invoice_kind?: string | null; status?: string | null; due_date?: string | null };

export type RotuloDaFatura = {
  /** "Deposit 50%", "Balance" ou null (fatura comum, sem rótulo). */
  nome: string | null;
  /** Texto do vencimento; null = usa a data de vencimento como sempre. */
  vencimento: string | null;
};

/** Job ainda não terminou: o saldo só é cobrado depois do final check. */
const ANTES_DO_FIM = new Set(["unassigned", "auto_assigning", "scheduled", "late", "in_progress", "on_hold", "final_check", "need_attention"]);

export function rotuloDaFaturaDoJob(
  fatura: FaturaParaRotulo,
  ctx: { temSinal: boolean; percentualDoSinal?: number | null; statusDoJob?: string | null },
): RotuloDaFatura {
  const paga = fatura.status === "paid";
  if (fatura.invoice_kind === "deposit") {
    const pct = ctx.percentualDoSinal && ctx.percentualDoSinal > 0 && ctx.percentualDoSinal < 100 ? ` ${Math.round(ctx.percentualDoSinal)}%` : "";
    return { nome: `Deposit${pct}`, vencimento: paga ? "Paid" : "Due now" };
  }
  if (ctx.temSinal && fatura.invoice_kind !== "deposit") {
    const antes = ANTES_DO_FIM.has(String(ctx.statusDoJob ?? ""));
    return { nome: "Balance", vencimento: paga ? "Paid" : antes ? "After the job" : null };
  }
  return { nome: null, vencimento: null };
}
