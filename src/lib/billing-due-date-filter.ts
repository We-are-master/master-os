/**
 * Self-billing payment filter: rows by `due_date` (partner payout Friday).
 * Used on Ready to Pay / Overdue tabs; Draft tab uses `created_at` instead.
 */

import { parseISO } from "date-fns";
import {
  listUpcomingPartnerPayoutSchedule,
  ORG_PARTNER_PAYOUT_STANDARD_TERMS,
} from "@/lib/partner-payout-schedule";

export type OrgPayoutScheduleCtx = {
  orgStandardTerms?: string | null;
  orgReferenceYmd?: string | null;
};

export type BillingDueDateFilterValue = {
  mode: "all" | "this_friday" | "next_friday" | "custom";
  /** YYYY-MM-DD — used when `mode === "custom"`. */
  customFrom?: string;
  customTo?: string;
};

export const DEFAULT_BILLING_DUE_DATE_FILTER: BillingDueDateFilterValue = {
  mode: "all",
  customFrom: "",
  customTo: "",
};

/** Next payout date(s) from Setup org standard schedule (biweekly / weekly / Net). */
export function upcomingOrgPayoutYmd(
  todayYmd: string,
  index: 0 | 1,
  ctx?: OrgPayoutScheduleCtx,
): string {
  const rows = listUpcomingPartnerPayoutSchedule(
    ctx?.orgStandardTerms ?? ORG_PARTNER_PAYOUT_STANDARD_TERMS,
    2,
    parseISO(`${todayYmd}T12:00:00`),
    ctx?.orgReferenceYmd ?? null,
  );
  return rows[index]?.payoutDueYmd ?? rows[0]?.payoutDueYmd ?? todayYmd;
}

/** Inclusive local calendar bounds for filtering `due_date` (YYYY-MM-DD). */
export function resolveBillingDueDateYmdBounds(
  value: BillingDueDateFilterValue,
  todayYmd: string,
  orgCtx?: OrgPayoutScheduleCtx,
): { from: string; to: string } | null {
  if (value.mode === "all") return null;
  if (value.mode === "this_friday") {
    const pay = upcomingOrgPayoutYmd(todayYmd, 0, orgCtx);
    return { from: pay, to: pay };
  }
  if (value.mode === "next_friday") {
    const pay = upcomingOrgPayoutYmd(todayYmd, 1, orgCtx);
    return { from: pay, to: pay };
  }
  const a = value.customFrom?.trim() ?? "";
  const b = value.customTo?.trim() ?? "";
  if (!a || !b) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export function billingDueDateFilterDescription(
  value: BillingDueDateFilterValue,
  todayYmd: string,
  orgCtx?: OrgPayoutScheduleCtx,
): string {
  if (value.mode === "all") return "All · payment due";
  if (value.mode === "this_friday") return `Due ${formatDateShort(upcomingOrgPayoutYmd(todayYmd, 0, orgCtx))}`;
  if (value.mode === "next_friday") return `Due ${formatDateShort(upcomingOrgPayoutYmd(todayYmd, 1, orgCtx))}`;
  const bounds = resolveBillingDueDateYmdBounds(value, todayYmd, orgCtx);
  if (!bounds) return "Pick from / to";
  const span =
    bounds.from === bounds.to ? bounds.from : `${bounds.from} – ${bounds.to}`;
  return `Due ${span}`;
}

export function billingDueDateFilterIsActive(
  value: BillingDueDateFilterValue,
  todayYmd: string,
  orgCtx?: OrgPayoutScheduleCtx,
): boolean {
  return value.mode !== "all" && resolveBillingDueDateYmdBounds(value, todayYmd, orgCtx) != null;
}

function formatDateShort(ymd: string): string {
  const d = parseISO(`${ymd}T12:00:00`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** True when `dueYmd` falls within inclusive bounds. */
export function dueYmdInBounds(dueYmd: string, bounds: { from: string; to: string }): boolean {
  const d = dueYmd.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d >= bounds.from && d <= bounds.to;
}
