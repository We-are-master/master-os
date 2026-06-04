import { addDays, isValid, parseISO } from "date-fns";
import { dueDateIsoFromPaymentTerms } from "@/lib/invoice-payment-terms";
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
): string {
  const terms = normalizePartnerPayoutStandardTerms(
    orgStandardTerms ?? ORG_PARTNER_PAYOUT_STANDARD_TERMS,
  );
  return dueDateIsoFromPaymentTerms(partnerPayoutAnchorFromWeekEnd(weekEndYmd), terms);
}

function localYmd(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/**
 * Next payout due date for Setup / copy — same math as Final review Standard,
 * anchored on the self-bill week that contains `from` (Mon–Sun), then future weeks if due is past.
 */
export function getNextPartnerPayoutReference(
  terms: string | null | undefined,
  from: Date = new Date(),
): { weekEndYmd: string; payoutDueYmd: string } {
  const normalized = normalizePartnerPayoutStandardTerms(terms);
  const todayYmd = localYmd(from);
  let probe = from;

  for (let i = 0; i < 8; i++) {
    const { weekEnd } = getWeekBoundsForDate(probe);
    const payoutDueYmd = computeOrgStandardPartnerDueIso(weekEnd, normalized);
    if (payoutDueYmd >= todayYmd) {
      return { weekEndYmd: weekEnd, payoutDueYmd };
    }
    const end = parseISO(`${weekEnd}T12:00:00`);
    probe = isValid(end) ? addDays(end, 1) : addDays(probe, 7);
  }

  const { weekEnd } = getWeekBoundsForDate(from);
  return {
    weekEndYmd: weekEnd,
    payoutDueYmd: computeOrgStandardPartnerDueIso(weekEnd, normalized),
  };
}

/** Partner self-bill due: partner terms when set, otherwise org standard (not legacy Friday+5). */
export function computePartnerSelfBillDueIso(
  weekEndYmd: string,
  partnerTerms: string | null | undefined,
  orgStandardTerms?: string | null,
): string {
  const terms = partnerTerms?.trim();
  if (terms) return partnerFieldSelfBillPaymentDueDate(weekEndYmd, terms);
  return computeOrgStandardPartnerDueIso(weekEndYmd, orgStandardTerms);
}

export function inferPartnerDueDateSource(
  storedDue: string | null | undefined,
  weekEndYmd: string,
  partnerTerms: string | null | undefined,
  orgStandardTerms?: string | null,
): DueDateSource {
  const stored = normalizeYmd(storedDue);
  const standard = computeOrgStandardPartnerDueIso(weekEndYmd, orgStandardTerms);
  const partner = computePartnerSelfBillDueIso(weekEndYmd, partnerTerms, orgStandardTerms);
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
