import { OFFICE_JOB_CANCELLATION_REASONS } from "@/lib/job-office-cancellation";

/**
 * Parsed from `company_settings.frontend_setup` (Settings → Setup).
 * Add keys here over time; keep defaults in DEFAULT_FRONTEND_SETUP.
 */
export type FrontendSetup = {
  /** Wall-clock hours from `bidding_started_at` until the SLA deadline in the UI. */
  bidding_sla_hours?: number;
  /** Presets for the “Put job on hold” modal (reason dropdown). */
  job_on_hold_presets?: string[];
  /**
   * Office cancel preset list: same fixed ids as code defaults; order and label text are configurable in Settings → Setup.
   */
  office_job_cancellation_presets?: OfficeJobCancellationPresetRow[];
};

export type OfficeJobCancellationPresetRow = { id: string; label: string };

/** Matches the original hardcoded list so behaviour is unchanged until Settings overrides. */
export const DEFAULT_JOB_ON_HOLD_PRESETS: string[] = [
  "Waiting for materials",
  "Client rescheduled",
  "Access issue",
  "Partner unavailable",
  "Awaiting confirmation",
  "Other",
];

export const MAX_JOB_ON_HOLD_PRESETS = 40;
export const MAX_JOB_ON_HOLD_PRESET_LEN = 160;
export const MAX_OFFICE_CANCEL_PRESET_LABEL_LEN = 200;

export const DEFAULT_FRONTEND_SETUP: FrontendSetup = {
  bidding_sla_hours: 8,
  job_on_hold_presets: [...DEFAULT_JOB_ON_HOLD_PRESETS],
};

export const MIN_BIDDING_SLA_HOURS = 0.5;
export const MAX_BIDDING_SLA_HOURS = 720;

export function clampBiddingSlaHours(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_FRONTEND_SETUP.bidding_sla_hours!;
  return Math.min(MAX_BIDDING_SLA_HOURS, Math.max(MIN_BIDDING_SLA_HOURS, n));
}

export function normalizeJobOnHoldPresets(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...(DEFAULT_FRONTEND_SETUP.job_on_hold_presets ?? DEFAULT_JOB_ON_HOLD_PRESETS)];
  const trimmed: string[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (typeof x !== "string") continue;
    const s = x.trim().slice(0, MAX_JOB_ON_HOLD_PRESET_LEN);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    trimmed.push(s);
    if (trimmed.length >= MAX_JOB_ON_HOLD_PRESETS) break;
  }
  if (trimmed.length === 0) return [...(DEFAULT_FRONTEND_SETUP.job_on_hold_presets ?? DEFAULT_JOB_ON_HOLD_PRESETS)];
  return trimmed;
}

/** Dropdown options for “Put job on hold” — order matches Settings → Setup. */
export function jobOnHoldPresetSelectOptions(presets: string[]): { value: string; label: string }[] {
  const normalized = normalizeJobOnHoldPresets(presets);
  return [{ value: "", label: "Select a reason..." }, ...normalized.map((r) => ({ value: r, label: r }))];
}

const ALLOWED_OFFICE_CANCEL_IDS = new Set<string>(OFFICE_JOB_CANCELLATION_REASONS.map((r) => r.id));

/** Full ordered list with labels (defaults merged with company overrides). */
export function normalizeOfficeJobCancellationPresets(raw: unknown): OfficeJobCancellationPresetRow[] {
  const defaultLabel = (id: string) =>
    OFFICE_JOB_CANCELLATION_REASONS.find((r) => r.id === id)?.label ?? id;

  const bySavedOrder: OfficeJobCancellationPresetRow[] = [];
  const seen = new Set<string>();

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const rid = typeof (item as { id?: unknown }).id === "string" ? (item as { id: string }).id.trim() : "";
      if (!rid || !ALLOWED_OFFICE_CANCEL_IDS.has(rid) || seen.has(rid)) continue;
      seen.add(rid);
      let label =
        typeof (item as { label?: unknown }).label === "string" ? (item as { label: string }).label.trim() : "";
      if (!label) label = defaultLabel(rid);
      label = label.slice(0, MAX_OFFICE_CANCEL_PRESET_LABEL_LEN);
      bySavedOrder.push({ id: rid, label });
    }
  }

  const merged: OfficeJobCancellationPresetRow[] = [...bySavedOrder];
  for (const canon of OFFICE_JOB_CANCELLATION_REASONS) {
    if (!seen.has(canon.id)) {
      merged.push({ id: canon.id, label: canon.label });
    }
  }
  return merged;
}

export function parseFrontendSetup(raw: unknown): FrontendSetup {
  const base: FrontendSetup = { ...DEFAULT_FRONTEND_SETUP };
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    base.office_job_cancellation_presets = normalizeOfficeJobCancellationPresets(null);
    return base;
  }
  const o = raw as Record<string, unknown>;
  if (o.bidding_sla_hours !== undefined) base.bidding_sla_hours = clampBiddingSlaHours(o.bidding_sla_hours);
  if (o.job_on_hold_presets !== undefined) base.job_on_hold_presets = normalizeJobOnHoldPresets(o.job_on_hold_presets);
  base.office_job_cancellation_presets = normalizeOfficeJobCancellationPresets(o.office_job_cancellation_presets);
  return base;
}

export function mergeFrontendSetup(prev: unknown, patch: Partial<FrontendSetup>): FrontendSetup {
  const base = parseFrontendSetup(prev);
  if (patch.bidding_sla_hours !== undefined) base.bidding_sla_hours = clampBiddingSlaHours(patch.bidding_sla_hours);
  if (patch.job_on_hold_presets !== undefined) base.job_on_hold_presets = normalizeJobOnHoldPresets(patch.job_on_hold_presets);
  if (patch.office_job_cancellation_presets !== undefined) {
    base.office_job_cancellation_presets = normalizeOfficeJobCancellationPresets(patch.office_job_cancellation_presets);
  }
  return base;
}

export function resolveJobOnHoldPresets(setup?: FrontendSetup | null): string[] {
  return normalizeJobOnHoldPresets(setup?.job_on_hold_presets ?? null);
}

export function resolveOfficeJobCancellationPresets(
  setup?: FrontendSetup | null,
): readonly OfficeJobCancellationPresetRow[] {
  return normalizeOfficeJobCancellationPresets(setup?.office_job_cancellation_presets ?? null);
}

export function resolveBiddingSlaHours(setup?: FrontendSetup | null): number {
  return clampBiddingSlaHours(setup?.bidding_sla_hours ?? DEFAULT_FRONTEND_SETUP.bidding_sla_hours);
}

export function biddingSlaMsFromHours(hours: number): number {
  return hours * 60 * 60 * 1000;
}

export function resolveBiddingSlaHoursFromCompanyRow(row: { frontend_setup?: unknown } | null | undefined): number {
  return resolveBiddingSlaHours(parseFrontendSetup(row?.frontend_setup));
}

export function formatBiddingSlaHoursLabel(hours: number): string {
  const h = clampBiddingSlaHours(hours);
  return `${h} h`;
}
