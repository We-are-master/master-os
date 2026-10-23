import type { Invoice, Job } from "@/types/database";
import { customerScheduledTotal, jobCustomerBillableRevenueForCollections } from "@/lib/job-financials";
import { inferInvoiceKind } from "@/lib/invoice-collection";

/** Parte pura do bump de fatura: roda no servidor e no navegador (sem cliente do banco). */

const EPS = 0.02;

/**
 * Target `invoices.amount` for a row linked to this job after job-side totals change
 * (extras, CCZ/parking → extras_amount, deposit/final schedule, hourly collections).
 */
export function linkedInvoiceTargetAmount(
  job: Job,
  inv: Invoice,
  opts?: { faturaUnicaDoJob?: boolean },
): number | null {
  if (inv.status === "cancelled") return null;
  if (inv.invoice_kind === "weekly_batch") return null;

  const billable = jobCustomerBillableRevenueForCollections(job);
  const scheduled = customerScheduledTotal(job);
  const fullTotal = Math.round(Math.max(0, Math.max(billable, scheduled)) * 100) / 100;

  /**
   * Fatura única do job é o job inteiro, qualquer que seja o `invoice_kind` gravado.
   *
   * O sinal na criação do job (PR #750) grava `customer_deposit` / `customer_final_payment`
   * (ex.: 90 / 90 num job de £180), e a fatura do job nasce como "final" pelos fallbacks
   * (`createOrAppendJobInvoice`, e o insert legado troca "combined" por "final"). Aí qualquer
   * edição do job rodava este bump e encolhia a fatura para a fatia do cronograma: RCP-2026-917
   * ficou com amount = 90 depois do sinal de £90, e o link do saldo disse "pago" (14/10/2026).
   * Fatia de sinal/final só faz sentido quando existe outra fatura cobrindo o resto (quote
   * aceito cria as duas).
   */
  if (opts?.faturaUnicaDoJob) {
    return fullTotal > EPS ? fullTotal : null;
  }

  const schedDep = Number(job.customer_deposit ?? 0);
  const schedFin = Number(job.customer_final_payment ?? 0);

  /** `weekly_batch` already returned null above — narrowed out here. */
  const kind =
    inv.invoice_kind && inv.invoice_kind !== "other" ? inv.invoice_kind : inferInvoiceKind(job, inv);

  if (kind === "deposit") {
    return schedDep > EPS ? Math.round(schedDep * 100) / 100 : null;
  }
  if (kind === "final") {
    return schedFin > EPS ? Math.round(schedFin * 100) / 100 : null;
  }
  return fullTotal > EPS ? fullTotal : null;
}

/** Faturas do job que dividem o total entre si (cancelada e lote semanal ficam de fora). */
export function faturasDoJobQueContam(linked: Pick<Invoice, "status" | "invoice_kind">[]): number {
  return linked.filter((i) => i.status !== "cancelled" && i.invoice_kind !== "weekly_batch").length;
}

