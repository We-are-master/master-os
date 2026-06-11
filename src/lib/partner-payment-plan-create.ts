import { emptyPaymentPlanRow, type PaymentPlanEditorRow } from "@/components/finance/payment-plan-editor";
import { defaultSelfBillPayoutPlanRows } from "@/lib/self-bill-payment-plan";
import type { SelfBillDueResolveContext } from "@/lib/partner-payout-schedule";
import { partnerPaymentCap } from "@/lib/job-financials";
import type { Job } from "@/types/database";

/** Split partner cap across client installment proportions (same dates). */
export function partnerPlanRowsFromClientSchedule(
  clientRows: PaymentPlanEditorRow[],
  clientTotal: number,
  partnerCap: number,
): PaymentPlanEditorRow[] {
  if (clientTotal <= 0.02 || partnerCap <= 0.02 || clientRows.length === 0) return [];
  const rows = clientRows.map((r) => {
    const share = (Number(r.amount) || 0) / clientTotal;
    return {
      ...emptyPaymentPlanRow(r.due_date),
      amount: Math.round(share * partnerCap * 100) / 100,
      due_date: r.due_date,
    };
  });
  const sum = rows.reduce((s, r) => s + Number(r.amount), 0);
  const drift = Math.round((partnerCap - sum) * 100) / 100;
  if (Math.abs(drift) > 0.01 && rows.length > 0) {
    const last = rows[rows.length - 1]!;
    last.amount = Math.round((Number(last.amount) + drift) * 100) / 100;
  }
  return rows;
}

export function partnerCapForJobForm(opts: {
  partner_cost: number;
  partner_agreed_value?: number | null;
  materials_cost?: number | null;
}): number {
  const cap = partnerPaymentCap({
    partner_cost: opts.partner_cost,
    partner_agreed_value: opts.partner_agreed_value ?? 0,
  });
  return Math.round((cap + Number(opts.materials_cost ?? 0)) * 100) / 100;
}

export function defaultPartnerPayoutPlanRows(
  partnerCap: number,
  installmentCount: number,
  dueCtx?: SelfBillDueResolveContext,
): PaymentPlanEditorRow[] {
  if (partnerCap <= 0.02) return [];
  const drafts = defaultSelfBillPayoutPlanRows(partnerCap, installmentCount, dueCtx ?? {});
  return drafts.map((d) => ({ ...emptyPaymentPlanRow(d.due_date), amount: d.amount, due_date: d.due_date }));
}

export function partnerCapFromJob(job: Pick<Job, "partner_cost" | "partner_agreed_value" | "materials_cost">): number {
  return partnerCapForJobForm({
    partner_cost: Number(job.partner_cost) || 0,
    partner_agreed_value: job.partner_agreed_value,
    materials_cost: job.materials_cost,
  });
}
