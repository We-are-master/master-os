import { resolveSelfBillDueYmd, type SelfBillDueResolveContext } from "@/lib/partner-payout-schedule";
import type { SelfBill, SelfBillPaymentInstallment } from "@/types/database";
import {
  PAYMENT_PLAN_EPS,
  splitEqually,
  type PaymentPlanInstallmentDraft,
  validateInstallmentsSum,
} from "@/lib/invoice-payment-plan";
import { listUpcomingPartnerPayoutSchedule } from "@/lib/partner-payout-schedule";

export { PAYMENT_PLAN_EPS, validateInstallmentsSum };
export type { PaymentPlanInstallmentDraft };

const READY_STATUSES = new Set<SelfBill["status"]>([
  "ready_to_pay",
  "pending_review",
  "awaiting_payment",
  "audit_required",
]);

export function hasActiveSelfBillPaymentPlan(
  installments: SelfBillPaymentInstallment[] | null | undefined,
): boolean {
  return (installments ?? []).some((i) => i.status !== "cancelled");
}

export function activeSelfBillInstallments(
  installments: SelfBillPaymentInstallment[],
): SelfBillPaymentInstallment[] {
  return [...installments]
    .filter((i) => i.status !== "cancelled")
    .sort((a, b) => a.sequence - b.sequence);
}

export function nextOpenSelfBillInstallment(
  installments: SelfBillPaymentInstallment[] | null | undefined,
): SelfBillPaymentInstallment | null {
  if (!installments?.length) return null;
  return activeSelfBillInstallments(installments).find((i) => i.status === "pending") ?? null;
}

export function selfBillEffectiveDueYmd(
  sb: Pick<SelfBill, "week_end" | "due_date" | "partner_id" | "bill_origin" | "payment_plan_active">,
  installments: SelfBillPaymentInstallment[] | null | undefined,
  dueCtx: SelfBillDueResolveContext,
): string {
  if (hasActiveSelfBillPaymentPlan(installments)) {
    const next = nextOpenSelfBillInstallment(installments);
    const raw = next?.due_date?.trim().slice(0, 10) ?? "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  }
  return resolveSelfBillDueYmd(sb, dueCtx);
}

export function selfBillIsDerivedOverdueWithPlan(
  sb: Pick<SelfBill, "status" | "week_end" | "due_date" | "partner_id" | "bill_origin" | "payment_plan_active">,
  installments: SelfBillPaymentInstallment[] | null | undefined,
  todayYmd: string,
  dueCtx: SelfBillDueResolveContext,
): boolean {
  if (!READY_STATUSES.has(sb.status)) return false;
  const exp = selfBillEffectiveDueYmd(sb, installments, dueCtx);
  if (!exp) return false;
  return todayYmd > exp;
}

export function selfBillPaymentPlanProgressLabel(
  installments: SelfBillPaymentInstallment[] | null | undefined,
): string | null {
  if (!hasActiveSelfBillPaymentPlan(installments)) return null;
  const active = activeSelfBillInstallments(installments!);
  const paid = active.filter((i) => i.status === "paid").length;
  const total = active.length;
  const next = nextOpenSelfBillInstallment(installments);
  if (!next) return `${paid}/${total} paid`;
  const due = next.due_date?.slice(0, 10) ?? "";
  const dueFmt = due
    ? new Date(`${due}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : "—";
  return `${paid}/${total} · next due ${dueFmt}`;
}

export type CashflowSelfBillInstallmentSlice = {
  selfBillId: string;
  installmentId: string;
  dueYmd: string;
  amount: number;
  label: string;
  detail?: string;
};

/** Pending installments for cash-flow Money Out bucketing. */
export function cashflowSlicesForSelfBill(
  sb: Pick<SelfBill, "id" | "partner_name" | "reference" | "week_label" | "bill_origin">,
  installments: SelfBillPaymentInstallment[] | null | undefined,
): CashflowSelfBillInstallmentSlice[] {
  if (!hasActiveSelfBillPaymentPlan(installments)) return [];
  const ref = sb.reference?.trim() || sb.week_label?.trim();
  const label =
    sb.bill_origin === "internal"
      ? sb.partner_name?.trim() || "Workforce"
      : sb.partner_name?.trim() || "Partner";
  return activeSelfBillInstallments(installments!)
    .filter((i) => i.status === "pending")
    .map((i) => ({
      selfBillId: sb.id,
      installmentId: i.id,
      dueYmd: (i.due_date ?? "").slice(0, 10),
      amount: Math.round(Number(i.amount ?? 0) * 100) / 100,
      label,
      detail: ref || undefined,
    }))
    .filter((s) => s.dueYmd && s.amount > PAYMENT_PLAN_EPS);
}

/** FIFO: how many installments are fully covered by cumulative partner paid. */
/** Amount to send via Wise — next open installment when plan active, else caller fallback. */
export function selfBillWisePayAmount(
  sb: Pick<SelfBill, "payment_plan_active" | "bill_origin">,
  installments: SelfBillPaymentInstallment[] | null | undefined,
  fallbackAmount: number,
): number {
  if (sb.bill_origin === "internal") return fallbackAmount;
  if (!sb.payment_plan_active || !hasActiveSelfBillPaymentPlan(installments)) {
    return fallbackAmount;
  }
  const next = nextOpenSelfBillInstallment(installments);
  if (!next) return 0;
  return Math.round(Number(next.amount ?? 0) * 100) / 100;
}

/** With an active plan, Wise pay is only allowed on/after the next installment due date (payout Friday). */
/** Default installment rows on upcoming payout Fridays (biweekly org standard or partner terms). */
export function defaultSelfBillPayoutPlanRows(
  total: number,
  count: number,
  ctx: {
    partnerTerms?: string | null;
    orgStandardTerms?: string | null;
    orgReferenceYmd?: string | null;
  },
): PaymentPlanInstallmentDraft[] {
  const amounts = splitEqually(total, count);
  const terms = ctx.partnerTerms?.trim() || ctx.orgStandardTerms;
  const schedule = listUpcomingPartnerPayoutSchedule(
    terms,
    count,
    new Date(),
    ctx.orgReferenceYmd,
  );
  const fallbackDue = schedule[0]?.payoutDueYmd ?? "";
  return amounts.map((amount, i) => ({
    amount,
    due_date: schedule[i]?.payoutDueYmd ?? fallbackDue,
  }));
}

export function selfBillIsInstallmentDueForWisePay(
  sb: Pick<SelfBill, "payment_plan_active" | "bill_origin">,
  installments: SelfBillPaymentInstallment[] | null | undefined,
  todayYmd: string,
): boolean {
  if (sb.bill_origin === "internal") return true;
  if (!sb.payment_plan_active || !hasActiveSelfBillPaymentPlan(installments)) {
    return true;
  }
  const next = nextOpenSelfBillInstallment(installments);
  if (!next) return false;
  const due = (next.due_date ?? "").slice(0, 10);
  return Boolean(due && todayYmd >= due);
}

export function countPaidSelfBillInstallmentsByAmount(
  installments: SelfBillPaymentInstallment[],
  amountPaid: number,
): number {
  let remaining = Math.round(Number(amountPaid ?? 0) * 100) / 100;
  let count = 0;
  for (const inst of activeSelfBillInstallments(installments)) {
    if (inst.status === "paid") {
      count += 1;
      continue;
    }
    const amt = Math.round(Number(inst.amount ?? 0) * 100) / 100;
    if (remaining + PAYMENT_PLAN_EPS >= amt) {
      remaining = Math.round((remaining - amt) * 100) / 100;
      count += 1;
    } else {
      break;
    }
  }
  return count;
}
