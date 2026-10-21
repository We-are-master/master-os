import type { JobFinanceStatus } from "@/types/database";

/**
 * Coluna "Payment" do Jobs Management: o dinheiro do cliente num rótulo só.
 *
 * Nomenclatura (dono, 21/10/2026): uma ou duas palavras na etiqueta, sempre o
 * ESTADO do dinheiro, nunca a ação; o detalhe (quanto, vencimento, motivo da
 * recusa, tentativa) fica no cartão do hover.
 *
 *  - Paid              valor integral recebido
 *  - Part paid         parte recebida; saldo dentro do prazo
 *  - Unpaid            nada recebido; dentro do prazo (ou sem fatura ainda)
 *  - Overdue           existe saldo vencido, mesmo com pagamento parcial
 *  - Retry scheduled   tentativa no cartão falhou e há nova tentativa agendada
 *  - Payment failed    tentativa falhou e precisa de intervenção
 *  - Action required   o cliente precisa autenticar o pagamento com o banco
 *
 * O cartão ganha de Overdue e de Part paid: é o motivo mais específico de o
 * dinheiro não ter entrado. Overdue ganha de Part paid: pagou uma parte e o
 * resto venceu é o caso que precisa de alguém cobrando.
 */
export type JobPaymentState =
  | "paid"
  | "partial"
  | "unpaid"
  | "overdue"
  | "card_declined"
  | "card_failed"
  | "bank_check";

export const JOB_PAYMENT_LABEL: Record<JobPaymentState, string> = {
  paid: "Paid",
  partial: "Part paid",
  unpaid: "Unpaid",
  overdue: "Overdue",
  card_declined: "Retry scheduled",
  card_failed: "Payment failed",
  bank_check: "Action required",
};

export type JobPaymentInput = {
  finance_status?: JobFinanceStatus | null;
  payment_status?: JobFinanceStatus | null;
  invoice_id?: string | null;
  card_charge_status?: string | null;
  card_retry_at?: string | null;
};

export function jobPaymentState(job: JobPaymentInput, overdueInvoiceIds: ReadonlySet<string>): JobPaymentState {
  const status = job.finance_status ?? job.payment_status ?? "unpaid";
  if (status === "paid") return "paid";
  if (job.card_charge_status === "refused") return job.card_retry_at ? "card_declined" : "card_failed";
  if (job.card_charge_status === "requires_action") return "bank_check";
  if (job.invoice_id && overdueInvoiceIds.has(job.invoice_id)) return "overdue";
  return status === "partial" ? "partial" : "unpaid";
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

/** O que a fatura do job diz, para o hover. */
export type JobInvoiceSummary = { reference?: string | null; dueDate?: string | null };

export type JobPaymentDetailInput = JobPaymentInput & {
  card_retry_count?: number | null;
  card_refused_reason?: string | null;
};

/** Total de tentativas no cartão: a do Final review + as novas (1, 3 e 7 dias). */
export const CARD_ATTEMPTS_TOTAL = 4;

export type JobPaymentDetail = {
  /** Frase de cima do cartão: o estado dito por inteiro (texto do dono, 21/10/2026). */
  headline: string;
  /** Linhas "rótulo · valor" do cartão. */
  rows: { label: string; value: string }[];
};

/** O texto do hover de cada etiqueta, palavra por palavra como o dono definiu. */
export const JOB_PAYMENT_TOOLTIP: Record<JobPaymentState, string> = {
  paid: "Payment received in full.",
  partial: "Part payment received. The remaining balance is not yet overdue.",
  unpaid: "No payment received. Payment is not yet overdue.",
  overdue: "An outstanding balance is past its due date.",
  card_declined: "Payment was unsuccessful. Another attempt is scheduled.",
  card_failed: "Payment was unsuccessful. Follow up to arrange payment.",
  bank_check: "The customer needs to authorise the payment with their bank.",
};

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Math.round(n * 100) / 100);

/** "Fri 23 Oct", no dia de Londres. */
export function diaCurtoDeLondres(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" }).format(d);
}

/** Dias inteiros entre a data (YYYY-MM-DD) e hoje em Londres; positivo = já passou. */
function diasDesde(ymd: string, hojeYmd: string): number {
  return Math.round((Date.parse(`${hojeYmd}T12:00:00Z`) - Date.parse(`${ymd.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
}

/**
 * O cartão do hover da etiqueta. Função pura: a tela só passa o que já tem
 * (total cobrável, quanto entrou, a fatura) e o dia de hoje em Londres.
 */
export function jobPaymentDetail(
  state: JobPaymentState,
  job: JobPaymentDetailInput,
  ctx: { billable: number; paid: number; invoice?: JobInvoiceSummary | null; todayYmd: string },
): JobPaymentDetail {
  const left = Math.max(0, ctx.billable - ctx.paid);
  const rows: JobPaymentDetail["rows"] = [];
  if (ctx.billable > 0) {
    rows.push({ label: "Paid", value: `${gbp(Math.min(ctx.paid, ctx.billable))} of ${gbp(ctx.billable)}` });
    if (left > 0.009) rows.push({ label: "Left to pay", value: gbp(left) });
  }
  if (ctx.invoice?.reference) rows.push({ label: "Invoice", value: ctx.invoice.reference });
  const due = ctx.invoice?.dueDate ? diaCurtoDeLondres(ctx.invoice.dueDate) : null;
  const atraso = ctx.invoice?.dueDate ? diasDesde(ctx.invoice.dueDate, ctx.todayYmd) : null;

  const tentativa = Math.min(CARD_ATTEMPTS_TOTAL, 1 + Math.max(0, Number(job.card_retry_count ?? 0)));
  const motivo = job.card_refused_reason?.trim() || null;

  switch (state) {
    case "partial":
    case "unpaid":
      if (due) rows.push({ label: "Due", value: due });
      break;
    case "overdue":
      if (due) rows.push({ label: "Due", value: atraso && atraso > 0 ? `${due} · ${atraso} ${atraso === 1 ? "day" : "days"} late` : due });
      break;
    case "card_declined": {
      if (motivo) rows.push({ label: "Reason", value: motivo });
      rows.push({ label: "Attempt", value: `${tentativa} of ${CARD_ATTEMPTS_TOTAL}` });
      const proxima = diaCurtoDeLondres(job.card_retry_at);
      if (proxima) rows.push({ label: "Next attempt", value: proxima });
      break;
    }
    case "card_failed":
      if (motivo) rows.push({ label: "Reason", value: motivo });
      // Sem "of 4": recusa que a bandeira não deixa repetir para já na 1ª.
      rows.push({ label: "Attempts", value: String(tentativa) });
      break;
    case "bank_check":
      if (motivo) rows.push({ label: "Reason", value: motivo });
      break;
  }
  return { headline: JOB_PAYMENT_TOOLTIP[state], rows };
}
