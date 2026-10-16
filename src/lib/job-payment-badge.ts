import type { JobFinanceStatus } from "@/types/database";

/**
 * Coluna "Payment" do Jobs Management: o dinheiro do cliente num rótulo só.
 *
 * Paid e Partial vêm do job (`finance_status`, gêmea de `payment_status`).
 * Overdue é a fatura do job vencida pela mesma regra da aba Overdue do
 * Finance (ver `overdueInvoiceIds`). O resto é Awaiting payment.
 *
 * Overdue ganha de Partial: pagou uma parte e o resto venceu é o caso que
 * precisa de alguém cobrando.
 */
export type JobPaymentState = "paid" | "partial" | "overdue" | "awaiting";

export const JOB_PAYMENT_LABEL: Record<JobPaymentState, string> = {
  paid: "Paid",
  partial: "Partial",
  overdue: "Overdue",
  awaiting: "Awaiting payment",
};

export type JobPaymentInput = {
  finance_status?: JobFinanceStatus | null;
  payment_status?: JobFinanceStatus | null;
  invoice_id?: string | null;
};

export function jobPaymentState(job: JobPaymentInput, overdueInvoiceIds: ReadonlySet<string>): JobPaymentState {
  const status = job.finance_status ?? job.payment_status ?? "unpaid";
  if (status === "paid") return "paid";
  if (job.invoice_id && overdueInvoiceIds.has(job.invoice_id)) return "overdue";
  return status === "partial" ? "partial" : "awaiting";
}

/** Jobs da lista que precisam da consulta de vencimento: têm fatura e ainda não estão pagos. */
export function invoiceIdsToCheckForOverdue(jobs: JobPaymentInput[]): string[] {
  const ids = new Set<string>();
  for (const job of jobs) {
    const status = job.finance_status ?? job.payment_status ?? "unpaid";
    if (job.invoice_id && status !== "paid") ids.add(job.invoice_id);
  }
  return [...ids];
}
