import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardDateBounds } from "@/lib/dashboard-date-range";
import { officeCancellationReasonLabel } from "@/lib/job-office-cancellation";
import { isPostgrestSelectSchemaError } from "@/lib/postgrest-errors";

export type PulseCancelledJobRow = {
  id: string;
  reference: string;
  title: string | null;
  created_at: string | null;
  cancellation_reason: string | null;
  cancellation_reason_preset_id: string | null;
  cancelled_client_price: number | null;
  cancelled_extras_amount: number | null;
  quote_id: string | null;
  service_type: string | null;
};

export type PulseCancelledReasonRow = {
  reason: string;
  jobCount: number;
  lostTotal: number;
};

export type PulseCancelledSummary = {
  lostTotal: number;
  count: number;
  topFiveReasons: PulseCancelledReasonRow[];
  aiHint: string;
};

/** Group cancelled jobs by reason; rank by lost £, then job count. */
export function buildTopFiveCancellationReasons(rows: PulseCancelledJobRow[]): PulseCancelledReasonRow[] {
  const byKey = new Map<string, PulseCancelledReasonRow>();

  for (const row of rows) {
    const key =
      row.cancellation_reason_preset_id?.trim() ||
      row.cancellation_reason?.trim()?.toLowerCase() ||
      "__unknown__";
    const reason = cancelReasonLabel(row);
    const lost = jobLostGbp(row);

    const existing = byKey.get(key);
    if (existing) {
      existing.jobCount += 1;
      existing.lostTotal += lost;
    } else {
      byKey.set(key, { reason, jobCount: 1, lostTotal: lost });
    }
  }

  return [...byKey.values()]
    .sort((a, b) => b.lostTotal - a.lostTotal || b.jobCount - a.jobCount)
    .slice(0, 5);
}

function jobLostGbp(job: Pick<PulseCancelledJobRow, "cancelled_client_price" | "cancelled_extras_amount">): number {
  return (Number(job.cancelled_client_price) || 0) + (Number(job.cancelled_extras_amount) || 0);
}

export function typeOfWorkLabel(job: PulseCancelledJobRow): string {
  const fromQuote = job.service_type?.trim();
  if (fromQuote) return fromQuote;
  const title = job.title?.trim();
  if (title) return title;
  return job.reference;
}

export function cancelReasonLabel(
  job: Pick<PulseCancelledJobRow, "cancellation_reason" | "cancellation_reason_preset_id">,
): string {
  if (job.cancellation_reason_preset_id?.trim()) {
    return officeCancellationReasonLabel(job.cancellation_reason_preset_id);
  }
  const text = job.cancellation_reason?.trim();
  if (!text) return "Cancelled";
  return text.length > 48 ? `${text.slice(0, 45)}…` : text;
}

function formatGbpCompact(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}

/** Plain-language label for the hint opener (not the full preset label). */
const FRIENDLY_REASON_PHRASE: Record<string, string> = {
  client_requested: "clients changing their mind after booking",
  scheduling_access: "scheduling or property access issues",
  duplicate_error: "duplicate jobs or jobs created in error",
  pricing_scope: "pricing or scope disagreements",
  partner_capacity: "not having the right partner available in time",
  weather_external: "weather or other external factors",
  other: "one-off cases that need a closer look",
};

/** Actionable coaching per cancellation preset — warm ops tone, no jargon. */
const COACHING_BY_PRESET: Record<string, string> = {
  client_requested:
    "Try a friendly confirmation the day before the visit, and make sure the quote matches what was agreed on the phone.",
  scheduling_access:
    "Before you dispatch, confirm keys, parking, contact on site, and that the time slot still works for the client.",
  duplicate_error:
    "Slow down intake: search for the same property and client in Jobs before raising a new ticket.",
  pricing_scope:
    "Align price and scope with the client before you confirm — surprises on the day are the usual trigger here.",
  partner_capacity:
    "Invite a wider pool of partners earlier, or line up a backup trade so you are not cancelling when the first choice is busy.",
  weather_external:
    "You cannot control the weather, but offering a fast reschedule often keeps the client and recovers the revenue.",
  other:
    "Read the notes on these jobs — recurring themes in free text usually point to one process tweak worth trying.",
};

function dominantPresetIdForReason(rows: PulseCancelledJobRow[], reasonLabel: string): string | null {
  for (const row of rows) {
    if (cancelReasonLabel(row) !== reasonLabel) continue;
    const id = row.cancellation_reason_preset_id?.trim();
    if (id) return id;
  }
  return null;
}

function coachingTip(presetId: string | null, reasonLabel: string): string {
  if (presetId && COACHING_BY_PRESET[presetId]) return COACHING_BY_PRESET[presetId];
  const lower = reasonLabel.toLowerCase();
  if (lower.includes("client")) return COACHING_BY_PRESET.client_requested;
  if (lower.includes("access") || lower.includes("schedul")) return COACHING_BY_PRESET.scheduling_access;
  if (lower.includes("duplic") || lower.includes("error")) return COACHING_BY_PRESET.duplicate_error;
  if (lower.includes("pric") || lower.includes("scope")) return COACHING_BY_PRESET.pricing_scope;
  if (lower.includes("partner")) return COACHING_BY_PRESET.partner_capacity;
  if (lower.includes("weather")) return COACHING_BY_PRESET.weather_external;
  return COACHING_BY_PRESET.other;
}

/** Friendly coaching copy from cancellation patterns (no API call). */
export function buildCancellationLossHint(rows: PulseCancelledJobRow[]): string {
  if (rows.length === 0) {
    return "No cancellations this period — keep doing what you are doing.";
  }

  const ranked = buildTopFiveCancellationReasons(rows);
  const top = ranked[0];
  if (!top) {
    return "Review cancelled jobs in the list below and look for anything that keeps repeating.";
  }

  const presetId = dominantPresetIdForReason(rows, top.reason);
  const phrase =
    (presetId && FRIENDLY_REASON_PHRASE[presetId]) ||
    top.reason.toLowerCase().replace(/\.$/, "");

  const jobWord = top.jobCount === 1 ? "job" : "jobs";
  const opener =
    ranked.length === 1
      ? `This month, lost revenue is mostly from ${phrase} (${top.jobCount} ${jobWord}, ${formatGbpCompact(top.lostTotal)}).`
      : `This month, most lost revenue comes from ${phrase} — ${top.jobCount} ${jobWord} (${formatGbpCompact(top.lostTotal)}).`;

  const tip = coachingTip(presetId, top.reason);

  const second = ranked[1];
  const totalLost = rows.reduce((s, r) => s + jobLostGbp(r), 0);
  if (second && totalLost > 0 && second.lostTotal / totalLost >= 0.2) {
    const secondPreset = dominantPresetIdForReason(rows, second.reason);
    const secondPhrase =
      (secondPreset && FRIENDLY_REASON_PHRASE[secondPreset]) ||
      second.reason.toLowerCase();
    return `${opener} ${tip} Also worth watching: ${secondPhrase} (${second.jobCount} ${second.jobCount === 1 ? "job" : "jobs"}).`;
  }

  return `${opener} ${tip}`;
}

type RawCancelledRow = {
  id: string;
  reference: string;
  title: string | null;
  created_at: string | null;
  cancellation_reason: string | null;
  cancellation_reason_preset_id?: string | null;
  cancelled_client_price: number | null;
  cancelled_extras_amount: number | null;
  quote_id?: string | null;
};

type CancelledJobsQueryResult = {
  data: RawCancelledRow[] | null;
  error: { message?: string; code?: string } | null;
};

function applyBounds<T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T }>(
  query: T,
  bounds: DashboardDateBounds | null,
): T {
  if (!bounds) return query;
  return query.gte("cancelled_at", bounds.fromIso).lte("cancelled_at", bounds.toIso);
}

async function attachQuoteServiceTypes(
  supabase: SupabaseClient,
  rows: RawCancelledRow[],
): Promise<PulseCancelledJobRow[]> {
  const quoteIds = [...new Set(rows.map((r) => r.quote_id?.trim()).filter(Boolean))] as string[];
  const serviceByQuote = new Map<string, string>();

  if (quoteIds.length > 0) {
    const { data } = await supabase.from("quotes").select("id, service_type").in("id", quoteIds);
    for (const q of data ?? []) {
      const row = q as { id: string; service_type?: string | null };
      if (row.service_type?.trim()) serviceByQuote.set(row.id, row.service_type.trim());
    }
  }

  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    title: r.title,
    created_at: r.created_at,
    cancellation_reason: r.cancellation_reason,
    cancellation_reason_preset_id: r.cancellation_reason_preset_id ?? null,
    cancelled_client_price: r.cancelled_client_price,
    cancelled_extras_amount: r.cancelled_extras_amount,
    quote_id: r.quote_id ?? null,
    service_type: r.quote_id ? serviceByQuote.get(r.quote_id) ?? null : null,
  }));
}

/**
 * Load cancelled jobs for Pulse Needs Attention — resilient to missing columns / no FK embed.
 */
export async function fetchPulseCancelledJobs(
  supabase: SupabaseClient,
  bounds: DashboardDateBounds | null,
): Promise<PulseCancelledSummary | null> {
  const fullSelect =
    "id, reference, title, created_at, cancellation_reason, cancellation_reason_preset_id, cancelled_client_price, cancelled_extras_amount, quote_id";
  const slimSelect =
    "id, reference, title, created_at, cancellation_reason, cancelled_client_price, cancelled_extras_amount, quote_id";

  let query = applyBounds(
    supabase
      .from("jobs")
      .select(fullSelect)
      .eq("status", "cancelled")
      .is("deleted_at", null)
      .order("cancelled_at", { ascending: false }),
    bounds,
  );

  let res: CancelledJobsQueryResult = await query;

  if (res.error && isPostgrestSelectSchemaError(res.error)) {
    res = await applyBounds(
      supabase
        .from("jobs")
        .select(slimSelect)
        .eq("status", "cancelled")
        .is("deleted_at", null)
        .order("cancelled_at", { ascending: false }),
      bounds,
    );
  }

  if (res.error || !res.data?.length) {
    res = await applyBounds(
      supabase
        .from("jobs")
        .select(
          "id, reference, title, created_at, cancellation_reason, cancelled_client_price, cancelled_extras_amount",
        )
        .eq("status", "cancelled")
        .is("deleted_at", null),
      bounds,
    );
  }

  if (res.error || !res.data?.length) {
    return null;
  }

  const rows = await attachQuoteServiceTypes(supabase, res.data ?? []);
  const lostTotal = rows.reduce((sum, j) => sum + jobLostGbp(j), 0);

  return {
    lostTotal,
    count: rows.length,
    topFiveReasons: buildTopFiveCancellationReasons(rows),
    aiHint: buildCancellationLossHint(rows),
  };
}
