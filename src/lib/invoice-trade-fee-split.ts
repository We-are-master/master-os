import { jobBillableRevenue, jobDirectCost, partnerSelfBillGrossAmount } from "@/lib/job-financials";
import type { Job } from "@/types/database";

export type InvoiceTradeFeeJob = Pick<
  Job,
  | "client_price"
  | "extras_amount"
  | "commission"
  | "partner_agreed_value"
  | "partner_cost"
  | "materials_cost"
>;

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export type SplitInvoiceTradeFeeOptions = {
  /** Fallback % of job revenue when margin/commission cannot be derived. */
  defaultPlatformFeePct?: number;
};

/**
 * Split an invoice amount into trade (partner) vs Fixfy platform fee for statements.
 * Scales full-job economics when the invoice is a deposit/partial slice.
 */
export function splitInvoiceTradeAndFee(
  chargedAmount: number,
  job?: InvoiceTradeFeeJob | null,
  options?: SplitInvoiceTradeFeeOptions,
): { trade: number; fee: number } {
  const total = Math.max(0, roundMoney(chargedAmount));
  if (!job || total <= 0) return { trade: total, fee: 0 };

  const jobRevenue = roundMoney(jobBillableRevenue(job));
  const storedCommission = Math.max(0, Number(job.commission ?? 0));

  const tradeFull = roundMoney(jobDirectCost(job));
  const feeFromMargin = Math.max(0, roundMoney(jobRevenue - tradeFull));
  const feeFromAgreed = Math.max(0, roundMoney(jobRevenue - partnerSelfBillGrossAmount(job)));

  let fullJobFee =
    storedCommission > 0.02 ? storedCommission : feeFromMargin > 0.02 ? feeFromMargin : feeFromAgreed;
  const defaultPct = Math.max(0, Number(options?.defaultPlatformFeePct ?? 0));
  if (fullJobFee <= 0.02 && defaultPct > 0 && jobRevenue > 0.02) {
    fullJobFee = roundMoney(jobRevenue * (defaultPct / 100));
  }
  const fullJobTrade = Math.max(0, roundMoney(jobRevenue - fullJobFee));

  if (jobRevenue <= 0.02) {
    const trade = Math.max(0, Math.min(total, tradeFull));
    return { trade, fee: Math.max(0, roundMoney(total - trade)) };
  }

  const scale = total / jobRevenue;
  let trade = roundMoney(fullJobTrade * scale);
  let fee = roundMoney(fullJobFee * scale);
  const drift = roundMoney(total - trade - fee);
  if (Math.abs(drift) > 0.01) {
    fee = roundMoney(fee + drift);
  }
  return { trade, fee };
}
