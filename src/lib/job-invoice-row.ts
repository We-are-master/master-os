/**
 * A linha da fatura de um job, montada sem banco (15/10/2026).
 *
 * `POST /api/jobs` não criava fatura nenhuma: o JOB-9730 nasceu sem, e alguém
 * teve de inserir a RCP-2026-935 à mão no formato que `createInvoice` usa. Este
 * é aquele formato, num lugar só, para o servidor (`ensure-job-invoice-server`)
 * não reinventar regra: rascunho, kind `final`, aguardando o final, nada pago,
 * conta herdada do cliente e o /pay/<ref> estável como link de pagamento.
 */
import { jobCustomerTotal } from "@/lib/job-financials";
import { isWeeklyConsolidatedTerms } from "@/lib/invoice-payment-terms";
import { invoicePayLinkUrl } from "@/lib/pay-link-url";
import type { Job } from "@/types/database";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * O total da fatura do job: preço + extras − promoção (o que o cliente deve),
 * ou a soma de sinal + final quando o job já veio com elas. Mesma conta do
 * `createJob` da tela.
 */
export function jobInvoiceTotal(
  job: Pick<Job, "client_price" | "extras_amount" | "promotion_amount" | "customer_deposit" | "customer_final_payment">,
): number {
  const billable = jobCustomerTotal(job);
  const scheduled = Number(job.customer_deposit ?? 0) + Number(job.customer_final_payment ?? 0);
  return round2(Math.max(0, billable, scheduled));
}

export type JobInvoiceRowInput = {
  reference: string;
  jobReference: string;
  clientName: string | null | undefined;
  amount: number;
  dueDate: string;
  sourceAccountId: string | null | undefined;
};

export function buildJobInvoiceRow(i: JobInvoiceRowInput) {
  const reference = i.reference.trim();
  const sourceAccountId = i.sourceAccountId?.trim() || null;
  return {
    reference,
    client_name: i.clientName?.trim() || "Client",
    job_reference: i.jobReference.trim(),
    amount: round2(Math.max(0, Number(i.amount) || 0)),
    status: "draft" as const,
    due_date: i.dueDate,
    invoice_kind: "final" as const,
    collection_stage: "awaiting_final" as const,
    collection_stage_locked: false,
    amount_paid: 0,
    stripe_payment_link_url: invoicePayLinkUrl(reference),
    ...(sourceAccountId ? { source_account_id: sourceAccountId } : {}),
  };
}

/**
 * Conta de fatura semanal ("Every N days", "Every Friday") junta os jobs da
 * semana numa fatura só (`createOrAppendJobInvoice`). Cobrar um job dela na
 * criação mandaria a fatura da semana inteira, então o servidor não cria nem
 * cobra: devolve o motivo.
 */
export function weeklyInvoiceSkipReason(
  paymentTerms: string | null | undefined,
  accountName: string | null | undefined,
): string | null {
  if (!isWeeklyConsolidatedTerms(paymentTerms)) return null;
  return `${accountName?.trim() || "This account"} is billed in one weekly invoice (${paymentTerms?.trim()}): no job invoice was created and no payment request was sent.`;
}
