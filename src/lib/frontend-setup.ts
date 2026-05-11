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
  /**
   * Active working weekdays. 0=Sun, 1=Mon, …, 6=Sat. Default Mon-Sat = [1,2,3,4,5,6].
   * Drives how monthly overhead (workforce + recurring bills) is allocated to days
   * in dashboards like Pulse.
   */
  working_days?: number[];
  /** Office hours, persisted for future use (SLA windows, Beacon time markers). HH:MM 24h. */
  working_hours?: { start: string; end: string };
  /**
   * SLA rules (Settings → Setup → SLA). All values in hours. Used by Pulse "SLA at risk"
   * and other dashboards to flag jobs about to breach their commitment.
   */
  sla_arrival_grace_hours?: number;
  sla_quote_send_hours?: number;
  sla_final_checks_hours?: number;

  /** Pulse defaults (Settings → Setup → Pulse Defaults). */
  pulse_default_preset?: PulsePresetId;
  pulse_live_jobs_count?: number;
  pulse_top_accounts_count?: number;
  pulse_revenue_weeks?: number;
  pulse_low_margin_pct?: number;

  /** Beacon defaults (Settings → Setup → Beacon Defaults). */
  beacon_default_view?: BeaconViewId;
  beacon_default_date_filter?: BeaconDateFilterId;
  beacon_partner_inactive_minutes?: number;
  beacon_default_region?: BeaconRegionId;

  /** Display formatting (Settings → Setup → Display). */
  display_currency?: CurrencyCode;
  display_locale?: LocaleId;
  display_time_format?: TimeFormatId;

  /** Greeting overrides (Settings → Setup → Display → App Greeting). */
  greeting_morning_until?: number; // hour 1-23, default 12
  greeting_evening_from?: number; // hour 1-23, default 18
  greeting_custom_text?: string; // optional override of "Good morning/afternoon/evening"

  /**
   * Zendesk subdomain (Settings → Setup → Integrations). Used to build
   * deep-links to tickets from the Zendesk badge popover. Falls back to the
   * server `ZENDESK_SUBDOMAIN` env var when not set here.
   */
  zendesk_subdomain?: string;
};

export type PulsePresetId = "1d" | "wtd" | "mtd" | "qtd" | "all";
export type BeaconViewId = "list" | "kanban" | "map";
export type BeaconDateFilterId = "today" | "tomorrow" | "week" | "month" | "all";
export type BeaconRegionId = "london" | "fit_all" | "uk" | "europe";
export type CurrencyCode = "GBP" | "USD" | "EUR";
export type LocaleId = "en-GB" | "en-US" | "pt-BR";
export type TimeFormatId = "24h" | "12h";

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

/** Mon-Sat (0=Sun excluded). Matches the default operating cadence of the company. */
export const DEFAULT_WORKING_DAYS: ReadonlyArray<number> = [1, 2, 3, 4, 5, 6];
export const DEFAULT_WORKING_HOURS: { start: string; end: string } = { start: "09:00", end: "18:00" };

export const DEFAULT_SLA_ARRIVAL_GRACE_HOURS = 1; // 60 min after scheduled_start_at
export const DEFAULT_SLA_QUOTE_SEND_HOURS = 24; // request → quote sent
export const DEFAULT_SLA_FINAL_CHECKS_HOURS = 8; // job in final_check before flagged

export const MIN_SLA_HOURS = 0.25;
export const MAX_SLA_HOURS = 720;

/** Pulse defaults — match the previously hardcoded constants. */
export const DEFAULT_PULSE_PRESET: PulsePresetId = "wtd";
export const DEFAULT_PULSE_LIVE_JOBS_COUNT = 5;
export const DEFAULT_PULSE_TOP_ACCOUNTS_COUNT = 5;
export const DEFAULT_PULSE_REVENUE_WEEKS = 8;
export const DEFAULT_PULSE_LOW_MARGIN_PCT = 20;
export const MIN_PULSE_ROW_COUNT = 3;
export const MAX_PULSE_ROW_COUNT = 20;
export const MIN_PULSE_REVENUE_WEEKS = 4;
export const MAX_PULSE_REVENUE_WEEKS = 26;

/** Beacon defaults — kanban opens first, today as the default range. */
export const DEFAULT_BEACON_VIEW: BeaconViewId = "kanban";
export const DEFAULT_BEACON_DATE_FILTER: BeaconDateFilterId = "today";
export const DEFAULT_BEACON_PARTNER_INACTIVE_MIN = 15;
export const DEFAULT_BEACON_REGION: BeaconRegionId = "london";

/** Display defaults. */
export const DEFAULT_DISPLAY_CURRENCY: CurrencyCode = "GBP";
export const DEFAULT_DISPLAY_LOCALE: LocaleId = "en-GB";
export const DEFAULT_DISPLAY_TIME_FORMAT: TimeFormatId = "24h";

/** Greeting cutoffs — keeps the original `getGreeting()` behaviour as default. */
export const DEFAULT_GREETING_MORNING_UNTIL = 12;
export const DEFAULT_GREETING_EVENING_FROM = 18;

export const DEFAULT_FRONTEND_SETUP: FrontendSetup = {
  bidding_sla_hours: 8,
  job_on_hold_presets: [...DEFAULT_JOB_ON_HOLD_PRESETS],
  working_days: [...DEFAULT_WORKING_DAYS],
  working_hours: { ...DEFAULT_WORKING_HOURS },
  sla_arrival_grace_hours: DEFAULT_SLA_ARRIVAL_GRACE_HOURS,
  sla_quote_send_hours: DEFAULT_SLA_QUOTE_SEND_HOURS,
  sla_final_checks_hours: DEFAULT_SLA_FINAL_CHECKS_HOURS,
  pulse_default_preset: DEFAULT_PULSE_PRESET,
  pulse_live_jobs_count: DEFAULT_PULSE_LIVE_JOBS_COUNT,
  pulse_top_accounts_count: DEFAULT_PULSE_TOP_ACCOUNTS_COUNT,
  pulse_revenue_weeks: DEFAULT_PULSE_REVENUE_WEEKS,
  pulse_low_margin_pct: DEFAULT_PULSE_LOW_MARGIN_PCT,
  beacon_default_view: DEFAULT_BEACON_VIEW,
  beacon_default_date_filter: DEFAULT_BEACON_DATE_FILTER,
  beacon_partner_inactive_minutes: DEFAULT_BEACON_PARTNER_INACTIVE_MIN,
  beacon_default_region: DEFAULT_BEACON_REGION,
  display_currency: DEFAULT_DISPLAY_CURRENCY,
  display_locale: DEFAULT_DISPLAY_LOCALE,
  display_time_format: DEFAULT_DISPLAY_TIME_FORMAT,
  greeting_morning_until: DEFAULT_GREETING_MORNING_UNTIL,
  greeting_evening_from: DEFAULT_GREETING_EVENING_FROM,
};

const PULSE_PRESET_IDS: PulsePresetId[] = ["1d", "wtd", "mtd", "qtd", "all"];
const BEACON_VIEW_IDS: BeaconViewId[] = ["list", "kanban", "map"];
const BEACON_DATE_FILTER_IDS: BeaconDateFilterId[] = ["today", "tomorrow", "week", "month", "all"];
const BEACON_REGION_IDS: BeaconRegionId[] = ["london", "fit_all", "uk", "europe"];
const CURRENCY_CODES: CurrencyCode[] = ["GBP", "USD", "EUR"];
const LOCALE_IDS: LocaleId[] = ["en-GB", "en-US", "pt-BR"];
const TIME_FORMAT_IDS: TimeFormatId[] = ["24h", "12h"];

function pickEnum<T extends string>(raw: unknown, allowed: T[], fallback: T): T {
  return typeof raw === "string" && (allowed as string[]).includes(raw) ? (raw as T) : fallback;
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampNum(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampSlaHours(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_SLA_HOURS, Math.max(MIN_SLA_HOURS, n));
}

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

/**
 * Normalize working_days array: keep only ints 0-6, dedupe, sort. Empty / invalid → default Mon-Sat.
 */
export function normalizeWorkingDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_WORKING_DAYS];
  const seen = new Set<number>();
  for (const x of raw) {
    const n = typeof x === "number" ? x : Number(x);
    if (!Number.isInteger(n)) continue;
    if (n < 0 || n > 6) continue;
    seen.add(n);
  }
  if (seen.size === 0) return [...DEFAULT_WORKING_DAYS];
  return [...seen].sort((a, b) => a - b);
}

/** "HH:MM" 24h, fallback to default when blank/invalid. */
function normalizeHHMM(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (!/^\d{1,2}:\d{2}$/.test(trimmed)) return fallback;
  const [h, m] = trimmed.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback;
  if (h < 0 || h > 23 || m < 0 || m > 59) return fallback;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function normalizeWorkingHours(raw: unknown): { start: string; end: string } {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_WORKING_HOURS };
  }
  const o = raw as { start?: unknown; end?: unknown };
  return {
    start: normalizeHHMM(o.start, DEFAULT_WORKING_HOURS.start),
    end: normalizeHHMM(o.end, DEFAULT_WORKING_HOURS.end),
  };
}

export function parseFrontendSetup(raw: unknown): FrontendSetup {
  const base: FrontendSetup = { ...DEFAULT_FRONTEND_SETUP };
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    base.office_job_cancellation_presets = normalizeOfficeJobCancellationPresets(null);
    base.working_days = [...DEFAULT_WORKING_DAYS];
    base.working_hours = { ...DEFAULT_WORKING_HOURS };
    return base;
  }
  const o = raw as Record<string, unknown>;
  if (o.bidding_sla_hours !== undefined) base.bidding_sla_hours = clampBiddingSlaHours(o.bidding_sla_hours);
  if (o.job_on_hold_presets !== undefined) base.job_on_hold_presets = normalizeJobOnHoldPresets(o.job_on_hold_presets);
  base.office_job_cancellation_presets = normalizeOfficeJobCancellationPresets(o.office_job_cancellation_presets);
  base.working_days = normalizeWorkingDays(o.working_days);
  base.working_hours = normalizeWorkingHours(o.working_hours);
  base.sla_arrival_grace_hours = clampSlaHours(o.sla_arrival_grace_hours, DEFAULT_SLA_ARRIVAL_GRACE_HOURS);
  base.sla_quote_send_hours = clampSlaHours(o.sla_quote_send_hours, DEFAULT_SLA_QUOTE_SEND_HOURS);
  base.sla_final_checks_hours = clampSlaHours(o.sla_final_checks_hours, DEFAULT_SLA_FINAL_CHECKS_HOURS);
  base.pulse_default_preset = pickEnum(o.pulse_default_preset, PULSE_PRESET_IDS, DEFAULT_PULSE_PRESET);
  base.pulse_live_jobs_count = clampInt(o.pulse_live_jobs_count, DEFAULT_PULSE_LIVE_JOBS_COUNT, MIN_PULSE_ROW_COUNT, MAX_PULSE_ROW_COUNT);
  base.pulse_top_accounts_count = clampInt(o.pulse_top_accounts_count, DEFAULT_PULSE_TOP_ACCOUNTS_COUNT, MIN_PULSE_ROW_COUNT, MAX_PULSE_ROW_COUNT);
  base.pulse_revenue_weeks = clampInt(o.pulse_revenue_weeks, DEFAULT_PULSE_REVENUE_WEEKS, MIN_PULSE_REVENUE_WEEKS, MAX_PULSE_REVENUE_WEEKS);
  base.pulse_low_margin_pct = clampNum(o.pulse_low_margin_pct, DEFAULT_PULSE_LOW_MARGIN_PCT, 0, 100);
  base.beacon_default_view = pickEnum(o.beacon_default_view, BEACON_VIEW_IDS, DEFAULT_BEACON_VIEW);
  base.beacon_default_date_filter = pickEnum(o.beacon_default_date_filter, BEACON_DATE_FILTER_IDS, DEFAULT_BEACON_DATE_FILTER);
  base.beacon_partner_inactive_minutes = clampInt(o.beacon_partner_inactive_minutes, DEFAULT_BEACON_PARTNER_INACTIVE_MIN, 1, 240);
  base.beacon_default_region = pickEnum(o.beacon_default_region, BEACON_REGION_IDS, DEFAULT_BEACON_REGION);
  base.display_currency = pickEnum(o.display_currency, CURRENCY_CODES, DEFAULT_DISPLAY_CURRENCY);
  base.display_locale = pickEnum(o.display_locale, LOCALE_IDS, DEFAULT_DISPLAY_LOCALE);
  base.display_time_format = pickEnum(o.display_time_format, TIME_FORMAT_IDS, DEFAULT_DISPLAY_TIME_FORMAT);
  base.greeting_morning_until = clampInt(o.greeting_morning_until, DEFAULT_GREETING_MORNING_UNTIL, 1, 23);
  base.greeting_evening_from = clampInt(o.greeting_evening_from, DEFAULT_GREETING_EVENING_FROM, 1, 23);
  if (typeof o.greeting_custom_text === "string") {
    base.greeting_custom_text = o.greeting_custom_text.trim().slice(0, 80) || undefined;
  }
  if (typeof o.zendesk_subdomain === "string") {
    base.zendesk_subdomain = normalizeZendeskSubdomain(o.zendesk_subdomain) || undefined;
  }
  return base;
}

/**
 * Normalize a Zendesk subdomain input. Accepts:
 *   - "company"
 *   - "company.zendesk.com"
 *   - "https://company.zendesk.com/agent/dashboard"
 * Returns the bare subdomain (`company`) or empty string if invalid.
 */
export function normalizeZendeskSubdomain(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let v = raw.trim().toLowerCase();
  if (!v) return "";
  // Strip protocol + path
  v = v.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  // Strip ".zendesk.com"
  v = v.replace(/\.zendesk\.com$/i, "");
  // Final validation: 1-63 chars, letters/digits/hyphens, no leading/trailing hyphen
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(v)) return "";
  return v;
}

export function mergeFrontendSetup(prev: unknown, patch: Partial<FrontendSetup>): FrontendSetup {
  const base = parseFrontendSetup(prev);
  if (patch.bidding_sla_hours !== undefined) base.bidding_sla_hours = clampBiddingSlaHours(patch.bidding_sla_hours);
  if (patch.job_on_hold_presets !== undefined) base.job_on_hold_presets = normalizeJobOnHoldPresets(patch.job_on_hold_presets);
  if (patch.office_job_cancellation_presets !== undefined) {
    base.office_job_cancellation_presets = normalizeOfficeJobCancellationPresets(patch.office_job_cancellation_presets);
  }
  if (patch.working_days !== undefined) base.working_days = normalizeWorkingDays(patch.working_days);
  if (patch.working_hours !== undefined) base.working_hours = normalizeWorkingHours(patch.working_hours);
  if (patch.sla_arrival_grace_hours !== undefined) {
    base.sla_arrival_grace_hours = clampSlaHours(patch.sla_arrival_grace_hours, DEFAULT_SLA_ARRIVAL_GRACE_HOURS);
  }
  if (patch.sla_quote_send_hours !== undefined) {
    base.sla_quote_send_hours = clampSlaHours(patch.sla_quote_send_hours, DEFAULT_SLA_QUOTE_SEND_HOURS);
  }
  if (patch.sla_final_checks_hours !== undefined) {
    base.sla_final_checks_hours = clampSlaHours(patch.sla_final_checks_hours, DEFAULT_SLA_FINAL_CHECKS_HOURS);
  }
  if (patch.pulse_default_preset !== undefined) {
    base.pulse_default_preset = pickEnum(patch.pulse_default_preset, PULSE_PRESET_IDS, DEFAULT_PULSE_PRESET);
  }
  if (patch.pulse_live_jobs_count !== undefined) {
    base.pulse_live_jobs_count = clampInt(patch.pulse_live_jobs_count, DEFAULT_PULSE_LIVE_JOBS_COUNT, MIN_PULSE_ROW_COUNT, MAX_PULSE_ROW_COUNT);
  }
  if (patch.pulse_top_accounts_count !== undefined) {
    base.pulse_top_accounts_count = clampInt(patch.pulse_top_accounts_count, DEFAULT_PULSE_TOP_ACCOUNTS_COUNT, MIN_PULSE_ROW_COUNT, MAX_PULSE_ROW_COUNT);
  }
  if (patch.pulse_revenue_weeks !== undefined) {
    base.pulse_revenue_weeks = clampInt(patch.pulse_revenue_weeks, DEFAULT_PULSE_REVENUE_WEEKS, MIN_PULSE_REVENUE_WEEKS, MAX_PULSE_REVENUE_WEEKS);
  }
  if (patch.pulse_low_margin_pct !== undefined) {
    base.pulse_low_margin_pct = clampNum(patch.pulse_low_margin_pct, DEFAULT_PULSE_LOW_MARGIN_PCT, 0, 100);
  }
  if (patch.beacon_default_view !== undefined) {
    base.beacon_default_view = pickEnum(patch.beacon_default_view, BEACON_VIEW_IDS, DEFAULT_BEACON_VIEW);
  }
  if (patch.beacon_default_date_filter !== undefined) {
    base.beacon_default_date_filter = pickEnum(patch.beacon_default_date_filter, BEACON_DATE_FILTER_IDS, DEFAULT_BEACON_DATE_FILTER);
  }
  if (patch.beacon_partner_inactive_minutes !== undefined) {
    base.beacon_partner_inactive_minutes = clampInt(patch.beacon_partner_inactive_minutes, DEFAULT_BEACON_PARTNER_INACTIVE_MIN, 1, 240);
  }
  if (patch.beacon_default_region !== undefined) {
    base.beacon_default_region = pickEnum(patch.beacon_default_region, BEACON_REGION_IDS, DEFAULT_BEACON_REGION);
  }
  if (patch.display_currency !== undefined) {
    base.display_currency = pickEnum(patch.display_currency, CURRENCY_CODES, DEFAULT_DISPLAY_CURRENCY);
  }
  if (patch.display_locale !== undefined) {
    base.display_locale = pickEnum(patch.display_locale, LOCALE_IDS, DEFAULT_DISPLAY_LOCALE);
  }
  if (patch.display_time_format !== undefined) {
    base.display_time_format = pickEnum(patch.display_time_format, TIME_FORMAT_IDS, DEFAULT_DISPLAY_TIME_FORMAT);
  }
  if (patch.greeting_morning_until !== undefined) {
    base.greeting_morning_until = clampInt(patch.greeting_morning_until, DEFAULT_GREETING_MORNING_UNTIL, 1, 23);
  }
  if (patch.greeting_evening_from !== undefined) {
    base.greeting_evening_from = clampInt(patch.greeting_evening_from, DEFAULT_GREETING_EVENING_FROM, 1, 23);
  }
  if (patch.greeting_custom_text !== undefined) {
    const v = typeof patch.greeting_custom_text === "string" ? patch.greeting_custom_text.trim().slice(0, 80) : "";
    base.greeting_custom_text = v || undefined;
  }
  if (patch.zendesk_subdomain !== undefined) {
    base.zendesk_subdomain = normalizeZendeskSubdomain(patch.zendesk_subdomain) || undefined;
  }
  return base;
}

export type ResolvedSlaRules = {
  arrivalGraceHours: number;
  quoteSendHours: number;
  finalChecksHours: number;
};

export function resolveSlaRules(setup?: FrontendSetup | null): ResolvedSlaRules {
  return {
    arrivalGraceHours: clampSlaHours(setup?.sla_arrival_grace_hours, DEFAULT_SLA_ARRIVAL_GRACE_HOURS),
    quoteSendHours: clampSlaHours(setup?.sla_quote_send_hours, DEFAULT_SLA_QUOTE_SEND_HOURS),
    finalChecksHours: clampSlaHours(setup?.sla_final_checks_hours, DEFAULT_SLA_FINAL_CHECKS_HOURS),
  };
}

export type ResolvedPulseDefaults = {
  preset: PulsePresetId;
  liveJobsCount: number;
  topAccountsCount: number;
  revenueWeeks: number;
  lowMarginPct: number;
};

export function resolvePulseDefaults(setup?: FrontendSetup | null): ResolvedPulseDefaults {
  return {
    preset: pickEnum(setup?.pulse_default_preset, PULSE_PRESET_IDS, DEFAULT_PULSE_PRESET),
    liveJobsCount: clampInt(setup?.pulse_live_jobs_count, DEFAULT_PULSE_LIVE_JOBS_COUNT, MIN_PULSE_ROW_COUNT, MAX_PULSE_ROW_COUNT),
    topAccountsCount: clampInt(setup?.pulse_top_accounts_count, DEFAULT_PULSE_TOP_ACCOUNTS_COUNT, MIN_PULSE_ROW_COUNT, MAX_PULSE_ROW_COUNT),
    revenueWeeks: clampInt(setup?.pulse_revenue_weeks, DEFAULT_PULSE_REVENUE_WEEKS, MIN_PULSE_REVENUE_WEEKS, MAX_PULSE_REVENUE_WEEKS),
    lowMarginPct: clampNum(setup?.pulse_low_margin_pct, DEFAULT_PULSE_LOW_MARGIN_PCT, 0, 100),
  };
}

export type ResolvedBeaconDefaults = {
  view: BeaconViewId;
  dateFilter: BeaconDateFilterId;
  partnerInactiveMinutes: number;
  region: BeaconRegionId;
};

export function resolveBeaconDefaults(setup?: FrontendSetup | null): ResolvedBeaconDefaults {
  return {
    view: pickEnum(setup?.beacon_default_view, BEACON_VIEW_IDS, DEFAULT_BEACON_VIEW),
    dateFilter: pickEnum(setup?.beacon_default_date_filter, BEACON_DATE_FILTER_IDS, DEFAULT_BEACON_DATE_FILTER),
    partnerInactiveMinutes: clampInt(setup?.beacon_partner_inactive_minutes, DEFAULT_BEACON_PARTNER_INACTIVE_MIN, 1, 240),
    region: pickEnum(setup?.beacon_default_region, BEACON_REGION_IDS, DEFAULT_BEACON_REGION),
  };
}

export type ResolvedDisplay = {
  currency: CurrencyCode;
  locale: LocaleId;
  timeFormat: TimeFormatId;
};

export function resolveDisplay(setup?: FrontendSetup | null): ResolvedDisplay {
  return {
    currency: pickEnum(setup?.display_currency, CURRENCY_CODES, DEFAULT_DISPLAY_CURRENCY),
    locale: pickEnum(setup?.display_locale, LOCALE_IDS, DEFAULT_DISPLAY_LOCALE),
    timeFormat: pickEnum(setup?.display_time_format, TIME_FORMAT_IDS, DEFAULT_DISPLAY_TIME_FORMAT),
  };
}

export type ResolvedGreeting = {
  morningUntil: number;
  eveningFrom: number;
  customText?: string;
};

export function resolveGreeting(setup?: FrontendSetup | null): ResolvedGreeting {
  return {
    morningUntil: clampInt(setup?.greeting_morning_until, DEFAULT_GREETING_MORNING_UNTIL, 1, 23),
    eveningFrom: clampInt(setup?.greeting_evening_from, DEFAULT_GREETING_EVENING_FROM, 1, 23),
    customText: setup?.greeting_custom_text?.trim() || undefined,
  };
}

/** Returns "Good morning|afternoon|evening" or the custom override, based on cutoffs. */
export function buildGreeting(now: Date, setup?: FrontendSetup | null): string {
  const g = resolveGreeting(setup);
  if (g.customText) return g.customText;
  const h = now.getHours();
  if (h < g.morningUntil) return "Good morning";
  if (h < g.eveningFrom) return "Good afternoon";
  return "Good evening";
}

export function formatCurrencyForSetup(amount: number, setup?: FrontendSetup | null): string {
  const { currency, locale } = resolveDisplay(setup);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
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

/** Set of weekday indices configured as working (default Mon-Sat). */
export function resolveWorkingDays(setup?: FrontendSetup | null): Set<number> {
  return new Set(normalizeWorkingDays(setup?.working_days ?? null));
}

export function resolveWorkingHours(setup?: FrontendSetup | null): { start: string; end: string } {
  return normalizeWorkingHours(setup?.working_hours ?? null);
}

export function isWorkingDay(date: Date, setup?: FrontendSetup | null): boolean {
  return resolveWorkingDays(setup).has(date.getDay());
}

/** Inclusive count of working days in [from..to], inspecting each calendar day. */
export function countWorkingDaysInRange(
  from: Date,
  to: Date,
  setup?: FrontendSetup | null,
): number {
  const days = resolveWorkingDays(setup);
  if (days.size === 0) return 0;
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  if (end < start) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    if (days.has(cursor.getDay())) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/**
 * Average working days per month given the configured weekly cadence.
 * 4.345 = 365.25 / 7 / 12 (avg weeks per month).
 */
export function monthlyWorkingDays(setup?: FrontendSetup | null): number {
  return resolveWorkingDays(setup).size * 4.345;
}
