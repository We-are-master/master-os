import { addDays, isValid, parseISO } from "date-fns";
import { dueDateIsoFromPaymentTerms, nextFridayOnOrAfter } from "@/lib/invoice-payment-terms";
import type { FrontendSetup } from "@/lib/frontend-setup";
import { getWeekBoundsForDate, partnerFieldSelfBillPaymentDueDate } from "@/lib/self-bill-period";
import { getSupabase } from "@/services/base";
import { isSupabaseMissingColumnError } from "@/lib/supabase-schema-compat";

/** Org default for partner self-bill payout when the partner has no schedule set. */
export const ORG_PARTNER_PAYOUT_STANDARD_TERMS = "Every 2 weeks on Friday";

/** Preset payout schedules (same list as partner drawer + Setup). */
export const PARTNER_PAYOUT_TERM_OPTIONS = [
  { value: "Net 7", label: "Net 7 — 7 days after week end" },
  { value: "Net 14", label: "Net 14 — 14 days after week end" },
  { value: "Net 30", label: "Net 30 — 30 days after week end" },
  { value: "Every Friday", label: "Weekly — every Friday" },
  { value: "Every 2 weeks on Friday", label: "Biweekly — every 2nd Friday" },
  { value: "Monthly cutoff 26 pay Friday", label: "Monthly — cutoff 26th, pay Friday" },
  { value: "Monthly cutoff 15 pay Friday", label: "Monthly — cutoff 15th, pay Friday" },
] as const;

export const PARTNER_PAYOUT_PRESET_VALUES: readonly string[] = PARTNER_PAYOUT_TERM_OPTIONS.map(
  (o) => o.value,
);

export function normalizePartnerPayoutStandardTerms(raw: unknown): string {
  const t = typeof raw === "string" ? raw.trim() : "";
  return (PARTNER_PAYOUT_PRESET_VALUES as readonly string[]).includes(t)
    ? t
    : ORG_PARTNER_PAYOUT_STANDARD_TERMS;
}

export function resolveOrgPartnerPayoutStandardTerms(setup?: FrontendSetup | null): string {
  return normalizePartnerPayoutStandardTerms(setup?.partner_payout_standard_terms);
}

/** True when partner uses org standard (blank payment_terms on profile). */
export function partnerUsesOrgPayoutStandard(partnerTerms: string | null | undefined): boolean {
  return !partnerTerms?.trim();
}

export function normalizePartnerPayoutReferenceYmd(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim().slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Biweekly Friday rhythm: anchor payouts on a stored reference Friday (Setup). */
export function applyOrgPayoutReferenceToTerms(
  terms: string,
  referenceYmd?: string | null,
): string {
  const ref = normalizePartnerPayoutReferenceYmd(referenceYmd);
  if (!ref) return terms;
  if (/every\s+2\s*weeks\s+on\s+friday/i.test(terms)) {
    return `Every 2 weeks cutoff friday pay friday ref ${ref}`;
  }
  return terms;
}

/** Best-effort read — never throws (missing column / RLS → null). */
export async function fetchPartnerPaymentTermsSafe(partnerId: string | null | undefined): Promise<string | null> {
  const id = partnerId?.trim();
  if (!id) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.from("partners").select("payment_terms").eq("id", id).maybeSingle();
  if (!error) {
    return (data as { payment_terms?: string | null } | null)?.payment_terms?.trim() || null;
  }
  if (isSupabaseMissingColumnError(error, "payment_terms")) return null;
  console.warn("[fetchPartnerPaymentTermsSafe]", error);
  return null;
}

export type DueDateSource = "standard" | "partner" | "custom";

function normalizeYmd(value: string | null | undefined): string {
  const s = value?.trim().slice(0, 10) ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

export function partnerPayoutAnchorFromWeekEnd(weekEndYmd: string): Date {
  const d = parseISO(weekEndYmd);
  return isValid(d) ? d : new Date();
}

/** Due date from org standard terms (Setup), anchored on self-bill week end. */
export function computeOrgStandardPartnerDueIso(
  weekEndYmd: string,
  orgStandardTerms?: string | null,
  orgReferenceYmd?: string | null,
): string {
  const normalized = normalizePartnerPayoutStandardTerms(
    orgStandardTerms ?? ORG_PARTNER_PAYOUT_STANDARD_TERMS,
  );
  if (isBiweeklyFridayTerms(normalized)) {
    return biweeklyFridayForWeekEnd(weekEndYmd, orgReferenceYmd);
  }
  if (isWeeklyFridayTerms(normalized)) {
    const we = parseISO(`${weekEndYmd}T12:00:00`);
    return nextFridayOnOrAfter(isValid(we) ? addDays(we, 1) : new Date());
  }
  const terms = applyOrgPayoutReferenceToTerms(normalized, orgReferenceYmd);
  return dueDateIsoFromPaymentTerms(partnerPayoutAnchorFromWeekEnd(weekEndYmd), terms);
}

export type PartnerPayoutSchedulePreviewRow = {
  payoutDueYmd: string;
  weekEndYmd: string;
};

function localYmd(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const d = parseISO(`${ymd}T12:00:00`);
  return isValid(d) ? localYmd(addDays(d, days)) : ymd;
}

function isBiweeklyFridayTerms(terms: string): boolean {
  return /every\s+2\s*weeks\s+on\s+friday/i.test(terms.trim());
}

function isWeeklyFridayTerms(terms: string): boolean {
  return /every\s+friday/i.test(terms.trim()) && !/2\s*weeks/i.test(terms.trim());
}

/** Work week (Mon–Sun) that closes the Sunday before payout Friday. */
function workWeekEndForPayoutFriday(payoutFridayYmd: string): string {
  const fri = parseISO(`${payoutFridayYmd}T12:00:00`);
  if (!isValid(fri)) return payoutFridayYmd;
  return getWeekBoundsForDate(addDays(fri, -5)).weekEnd;
}

/** Pay Fridays every 14 days (optional anchor); used in Setup preview + Use calculated. */
function biweeklyFridayCadencePayDates(
  from: Date,
  count: number,
  anchorYmd?: string | null,
): PartnerPayoutSchedulePreviewRow[] {
  const todayYmd = localYmd(from);
  const anchor = normalizePartnerPayoutReferenceYmd(anchorYmd);
  let pay: string;

  if (anchor) {
    pay = anchor;
    if (pay < todayYmd) {
      const periods = Math.ceil(
        (parseISO(`${todayYmd}T12:00:00`).getTime() - parseISO(`${anchor}T12:00:00`).getTime()) /
          86_400_000 /
          14,
      );
      pay = addDaysYmd(anchor, Math.max(0, periods) * 14);
    }
  } else {
    pay = nextFridayOnOrAfter(from);
    while (pay < todayYmd) pay = addDaysYmd(pay, 14);
  }

  const rows: PartnerPayoutSchedulePreviewRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({ payoutDueYmd: pay, weekEndYmd: workWeekEndForPayoutFriday(pay) });
    pay = addDaysYmd(pay, 14);
  }
  return rows;
}

function weeklyFridayCadencePayDates(from: Date, count: number): PartnerPayoutSchedulePreviewRow[] {
  const todayYmd = localYmd(from);
  let pay = nextFridayOnOrAfter(from);
  while (pay < todayYmd) pay = addDaysYmd(pay, 7);

  const rows: PartnerPayoutSchedulePreviewRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({ payoutDueYmd: pay, weekEndYmd: workWeekEndForPayoutFriday(pay) });
    pay = addDaysYmd(pay, 7);
  }
  return rows;
}

/** Self-bill week end → pay Friday on the org biweekly grid (reference anchor when set). */
function biweeklyFridayForWeekEnd(weekEndYmd: string, anchorYmd?: string | null): string {
  const we = parseISO(`${weekEndYmd}T12:00:00`);
  const minPay = nextFridayOnOrAfter(isValid(we) ? addDays(we, 1) : new Date());
  const ref = normalizePartnerPayoutReferenceYmd(anchorYmd);

  if (!ref) {
    let pay = nextFridayOnOrAfter(isValid(we) ? addDays(we, 1) : new Date());
    while (pay < minPay) pay = addDaysYmd(pay, 14);
    return pay;
  }

  let pay = ref;
  while (pay < weekEndYmd) pay = addDaysYmd(pay, 14);
  while (pay < minPay) pay = addDaysYmd(pay, 14);
  return pay;
}

/** Auto next payout from schedule only (no stored reference override). */
export function getCalculatedPartnerPayoutReference(
  terms: string | null | undefined,
  from: Date = new Date(),
): { weekEndYmd: string; payoutDueYmd: string } {
  const normalized = normalizePartnerPayoutStandardTerms(terms);

  if (isBiweeklyFridayTerms(normalized)) {
    const row = biweeklyFridayCadencePayDates(from, 1, null)[0]!;
    return { weekEndYmd: row.weekEndYmd, payoutDueYmd: row.payoutDueYmd };
  }
  if (isWeeklyFridayTerms(normalized)) {
    const row = weeklyFridayCadencePayDates(from, 1)[0]!;
    return { weekEndYmd: row.weekEndYmd, payoutDueYmd: row.payoutDueYmd };
  }

  const todayYmd = localYmd(from);
  let probe = from;

  for (let i = 0; i < 8; i++) {
    const { weekEnd } = getWeekBoundsForDate(probe);
    const payoutDueYmd = computeOrgStandardPartnerDueIso(weekEnd, normalized, null);
    if (payoutDueYmd >= todayYmd) {
      return { weekEndYmd: weekEnd, payoutDueYmd };
    }
    const end = parseISO(`${weekEnd}T12:00:00`);
    probe = isValid(end) ? addDays(end, 1) : addDays(probe, 7);
  }

  const { weekEnd } = getWeekBoundsForDate(from);
  return {
    weekEndYmd: weekEnd,
    payoutDueYmd: computeOrgStandardPartnerDueIso(weekEnd, normalized, null),
  };
}

/**
 * Next payout for Setup — calculated from schedule, overridable via stored reference YMD.
 */
export function getNextPartnerPayoutReference(
  terms: string | null | undefined,
  from: Date = new Date(),
  storedReferenceYmd?: string | null,
): { weekEndYmd: string; payoutDueYmd: string; calculatedPayoutDueYmd: string } {
  const calculated = getCalculatedPartnerPayoutReference(terms, from);
  const ref = normalizePartnerPayoutReferenceYmd(storedReferenceYmd);
  const todayYmd = localYmd(from);
  const payoutDueYmd = ref && ref >= todayYmd ? ref : calculated.payoutDueYmd;
  const weekEndYmd =
    ref && ref >= todayYmd ? workWeekEndForPayoutFriday(ref) : calculated.weekEndYmd;
  return { weekEndYmd, payoutDueYmd, calculatedPayoutDueYmd: calculated.payoutDueYmd };
}

/** Next N distinct payout dates from the org schedule (Setup preview table). */
export function listUpcomingPartnerPayoutSchedule(
  terms: string | null | undefined,
  count: number,
  from: Date = new Date(),
  storedReferenceYmd?: string | null,
): PartnerPayoutSchedulePreviewRow[] {
  const limit = Math.max(1, Math.min(count, 12));
  const normalized = normalizePartnerPayoutStandardTerms(terms);

  if (isBiweeklyFridayTerms(normalized)) {
    return biweeklyFridayCadencePayDates(from, limit, storedReferenceYmd);
  }
  if (isWeeklyFridayTerms(normalized)) {
    return weeklyFridayCadencePayDates(from, limit);
  }

  const first = getNextPartnerPayoutReference(terms, from, storedReferenceYmd);
  const rows: PartnerPayoutSchedulePreviewRow[] = [
    { payoutDueYmd: first.payoutDueYmd, weekEndYmd: first.weekEndYmd },
  ];
  const seen = new Set<string>([first.payoutDueYmd]);
  let probe = parseISO(`${first.weekEndYmd}T12:00:00`);
  probe = isValid(probe) ? addDays(probe, 1) : addDays(from, 7);

  for (let i = 0; i < 52 && rows.length < limit; i++) {
    const { weekEnd } = getWeekBoundsForDate(probe);
    const payoutDueYmd = computeOrgStandardPartnerDueIso(weekEnd, terms, storedReferenceYmd);
    const lastPay = rows[rows.length - 1]!.payoutDueYmd;
    if (!seen.has(payoutDueYmd) && payoutDueYmd > lastPay) {
      seen.add(payoutDueYmd);
      rows.push({ payoutDueYmd, weekEndYmd: weekEnd });
    }
    const end = parseISO(`${weekEnd}T12:00:00`);
    probe = isValid(end) ? addDays(end, 1) : addDays(probe, 7);
  }

  return rows;
}

/** Partner self-bill due: partner terms when set, otherwise org standard (not legacy Friday+5). */
export function computePartnerSelfBillDueIso(
  weekEndYmd: string,
  partnerTerms: string | null | undefined,
  orgStandardTerms?: string | null,
  orgReferenceYmd?: string | null,
): string {
  const terms = partnerTerms?.trim();
  if (terms) return partnerFieldSelfBillPaymentDueDate(weekEndYmd, terms);
  return computeOrgStandardPartnerDueIso(weekEndYmd, orgStandardTerms, orgReferenceYmd);
}

export function inferPartnerDueDateSource(
  storedDue: string | null | undefined,
  weekEndYmd: string,
  partnerTerms: string | null | undefined,
  orgStandardTerms?: string | null,
  orgReferenceYmd?: string | null,
): DueDateSource {
  const stored = normalizeYmd(storedDue);
  const standard = computeOrgStandardPartnerDueIso(weekEndYmd, orgStandardTerms, orgReferenceYmd);
  const partner = computePartnerSelfBillDueIso(weekEndYmd, partnerTerms, orgStandardTerms, orgReferenceYmd);
  if (!stored) return partnerTerms?.trim() ? "partner" : "standard";
  if (partnerTerms?.trim() && stored === partner) return "partner";
  if (stored === standard) return "standard";
  if (stored === partner) return partnerTerms?.trim() ? "partner" : "standard";
  return "custom";
}

/** Invoice due inferred vs account-terms computation (standard = matches account terms). */
export function inferInvoiceDueDateSource(
  storedDue: string | null | undefined,
  computedFromAccountTerms: string,
): DueDateSource {
  const stored = normalizeYmd(storedDue);
  const computed = normalizeYmd(computedFromAccountTerms);
  if (!stored || !computed) return "standard";
  if (stored === computed) return "standard";
  return "custom";
}

export function dueDateSourceLabel(source: DueDateSource): string {
  switch (source) {
    case "standard":
      return "Standard";
    case "partner":
      return "Partner";
    case "custom":
      return "Custom";
  }
}
