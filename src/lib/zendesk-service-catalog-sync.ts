/**
 * Mirror a service_catalog row (Type of Work) into Zendesk as an option on
 * the Type of Work tagger ticket field.
 *
 * Why: macros and the Type of Work picker inside Zendesk should match the
 * canonical list the OS uses for jobs. When the inbound /api/jobs webhook
 * receives a ticket with that field set, the option's `value` (tag) is the
 * OS service_catalog.id — so the API can resolve the right catalog row by
 * UUID without label-matching.
 *
 * Mechanics: Zendesk has no "add single option" endpoint for ticket fields;
 * the full `custom_field_options` array must be PUT back together. We GET
 * the field, edit the array in memory, then PUT the whole thing back.
 * Idempotent — re-runs match on the option's `value` (the UUID) and update
 * the name in place, or append when missing.
 *
 * Called fire-and-forget from the catalog mutation helpers so a Zendesk
 * outage never blocks creating/editing a service in the OS.
 */

import { createServiceClient } from "@/lib/supabase/service";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTypeOfWork } from "@/lib/type-of-work";

const SUBDOMAIN  = process.env.ZENDESK_SUBDOMAIN?.trim();
const EMAIL      = process.env.ZENDESK_EMAIL?.trim();
const API_TOKEN  = process.env.ZENDESK_API_TOKEN?.trim();
const FIELD_ID   = process.env.ZENDESK_TYPE_OF_WORK_FIELD_ID?.trim();

function isConfigured(): boolean {
  return Boolean(SUBDOMAIN && EMAIL && API_TOKEN && FIELD_ID);
}

function authHeader(): string {
  return "Basic " + Buffer.from(`${EMAIL}/token:${API_TOKEN}`).toString("base64");
}

function fieldUrl(): string {
  return `https://${SUBDOMAIN}.zendesk.com/api/v2/ticket_fields/${FIELD_ID}.json`;
}

/** Single option on a Zendesk tagger ticket field. */
interface ZendeskFieldOption {
  id?:       number;
  name:      string;
  value:     string;
  position?: number;
}

export interface ServiceCatalogZendeskSyncResult {
  ok:        boolean;
  optionId?: string | null;
  skipped?:  string;
  error?:    string;
}

async function fetchFieldOptions(): Promise<{
  ok: true; options: ZendeskFieldOption[];
} | { ok: false; error: string }> {
  const res = await fetch(fieldUrl(), {
    method:  "GET",
    headers: { Authorization: authHeader(), Accept: "application/json" },
    cache:   "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `zendesk GET ${res.status}: ${body.slice(0, 300)}` };
  }
  const data = await res.json() as { ticket_field?: { custom_field_options?: ZendeskFieldOption[] } };
  return { ok: true, options: data.ticket_field?.custom_field_options ?? [] };
}

async function putFieldOptions(options: ZendeskFieldOption[]): Promise<{
  ok: true; options: ZendeskFieldOption[];
} | { ok: false; error: string }> {
  const res = await fetch(fieldUrl(), {
    method:  "PUT",
    headers: {
      Authorization:  authHeader(),
      "Content-Type": "application/json",
      Accept:         "application/json",
    },
    body: JSON.stringify({ ticket_field: { custom_field_options: options } }),
  });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `zendesk PUT ${res.status}: ${body.slice(0, 300)}` };
  }
  const data = await res.json() as { ticket_field?: { custom_field_options?: ZendeskFieldOption[] } };
  return { ok: true, options: data.ticket_field?.custom_field_options ?? [] };
}

/**
 * Create or update the Zendesk option for a single service_catalog row.
 * Persists the resulting option id back on the row when present.
 *
 * Match key inside Zendesk's options array: `value === catalogId` (the OS
 * UUID is the option's tag). When found, the option's `name` is updated to
 * match the catalog row's name; otherwise a new option is appended.
 */
export async function upsertCatalogOptionInZendesk(
  catalogId: string,
  opts?: { client?: SupabaseClient },
): Promise<ServiceCatalogZendeskSyncResult> {
  if (!isConfigured()) return { ok: false, skipped: "zendesk_not_configured" };
  if (!catalogId)      return { ok: false, error: "catalogId is required" };

  const supabase = opts?.client ?? createServiceClient();

  const { data: row, error } = await supabase
    .from("service_catalog")
    .select("id, name, is_active, deleted_at, zendesk_option_id")
    .eq("id", catalogId)
    .maybeSingle();
  if (error || !row) {
    return { ok: false, error: error?.message ?? "service_catalog_row_not_found" };
  }
  const r = row as {
    id: string;
    name: string | null;
    is_active: boolean | null;
    deleted_at: string | null;
    zendesk_option_id: string | null;
  };

  // Soft-deleted rows shouldn't have a live option in Zendesk — defer to the
  // remove path so the option leaves the dropdown.
  if (r.deleted_at) {
    return removeCatalogOptionFromZendesk(r.id, { client: supabase });
  }

  const name = r.name?.trim();
  if (!name) return { ok: false, skipped: "catalog_row_has_no_name" };

  const cur = await fetchFieldOptions();
  if (!cur.ok) return { ok: false, error: cur.error };

  // Use `value` (the tag) as the match key. The Zendesk option id is
  // unstable across deletes, so we don't rely on it for matching — but we
  // still write it back to the row for fast lookup later.
  const next = [...cur.options];
  const idx  = next.findIndex((o) => o.value === r.id);
  if (idx >= 0) {
    next[idx] = { ...next[idx], name, value: r.id };
  } else {
    next.push({ name, value: r.id });
  }

  const put = await putFieldOptions(next);
  if (!put.ok) return { ok: false, error: put.error };

  const stored = put.options.find((o) => o.value === r.id);
  const optionId = stored?.id != null ? String(stored.id) : null;

  if (optionId && optionId !== r.zendesk_option_id) {
    const { error: upErr } = await supabase
      .from("service_catalog")
      .update({ zendesk_option_id: optionId })
      .eq("id", r.id);
    if (upErr) {
      return { ok: false, optionId, error: `persist: ${upErr.message}` };
    }
  }

  return { ok: true, optionId };
}

/**
 * Drop the option for a service_catalog row from the Zendesk field. Used on
 * soft-delete. Also clears zendesk_option_id locally so future re-creations
 * generate a fresh option (Zendesk re-uses option ids only by name + value).
 */
export async function removeCatalogOptionFromZendesk(
  catalogId: string,
  opts?: { client?: SupabaseClient },
): Promise<ServiceCatalogZendeskSyncResult> {
  if (!isConfigured()) return { ok: false, skipped: "zendesk_not_configured" };
  if (!catalogId)      return { ok: false, error: "catalogId is required" };

  const cur = await fetchFieldOptions();
  if (!cur.ok) return { ok: false, error: cur.error };

  const filtered = cur.options.filter((o) => o.value !== catalogId);
  if (filtered.length === cur.options.length) {
    // Nothing to remove on the Zendesk side, but clear the local id anyway
    // so the row matches reality.
    const supabase = opts?.client ?? createServiceClient();
    await supabase.from("service_catalog").update({ zendesk_option_id: null }).eq("id", catalogId);
    return { ok: true, optionId: null, skipped: "option_not_present" };
  }

  const put = await putFieldOptions(filtered);
  if (!put.ok) return { ok: false, error: put.error };

  const supabase = opts?.client ?? createServiceClient();
  await supabase.from("service_catalog").update({ zendesk_option_id: null }).eq("id", catalogId);
  return { ok: true, optionId: null };
}

export interface BackfillPlanEntry {
  /** "rewrite"   = same option_id, value changes slug → UUID, name normalized to OS.
   *  "rename"    = same option_id, value already UUID, only name updated to OS.
   *  "unchanged" = option already matches OS, nothing to do.
   *  "keep"      = legacy option Zendesk owns (non-UUID value, no OS match) — left alone.
   *  "prune"     = UUID value that no longer points to an active OS row.
   *  "append"    = OS row missing on the Zendesk side, will be added. */
  action:    "rewrite" | "rename" | "unchanged" | "keep" | "prune" | "append";
  /** Option id (if any). undefined for "append". */
  optionId?: number;
  /** Current Zendesk value (undefined for "append"). */
  fromValue?: string;
  /** Current Zendesk name (undefined for "append"). */
  fromName?:  string;
  /** New Zendesk value (set for rewrite + append). */
  toValue?:   string;
  /** New Zendesk name (set for rewrite + rename + append). */
  toName?:    string;
  /** OS catalog id this entry locks to (if matched). */
  catalogId?: string;
}

export interface BackfillPlan {
  options:  ZendeskFieldOption[];
  entries:  BackfillPlanEntry[];
  stats: {
    rewrite:   number;
    rename:    number;
    unchanged: number;
    keep:      number;
    prune:     number;
    append:    number;
  };
}

/**
 * Pure function — given the current Zendesk options and the OS catalog rows,
 * produce the next options array plus a per-entry plan describing what would
 * change. No I/O; safe to call from tests, scripts, and dryRun endpoints.
 */
export function planCatalogBackfill(
  zendeskOptions: ZendeskFieldOption[],
  catalog: { id: string; name: string | null }[],
): BackfillPlan {
  const activeRows = catalog
    .filter((r) => (r.name ?? "").trim().length > 0)
    .map((r) => ({ id: r.id, name: r.name!.trim() }));
  const catalogIds = new Set(activeRows.map((r) => r.id));
  const remaining  = new Map(activeRows.map((r) => [r.id, r] as const));

  const entries: BackfillPlanEntry[] = [];
  const next:    ZendeskFieldOption[] = [];
  const stats = { rewrite: 0, rename: 0, unchanged: 0, keep: 0, prune: 0, append: 0 };

  for (const o of zendeskOptions) {
    if (looksLikeUuid(o.value)) {
      // Already keyed by UUID — fast path.
      const row = remaining.get(o.value);
      if (!row) {
        // UUID points to a catalog row that's gone (soft-deleted or never existed).
        entries.push({ action: "prune", optionId: o.id, fromValue: o.value, fromName: o.name });
        stats.prune++;
        continue;
      }
      if (o.name === row.name) {
        next.push(o);
        entries.push({
          action:    "unchanged",
          optionId:  o.id,
          fromValue: o.value,
          fromName:  o.name,
          catalogId: row.id,
        });
        stats.unchanged++;
      } else {
        next.push({ ...o, name: row.name });
        entries.push({
          action:    "rename",
          optionId:  o.id,
          fromValue: o.value,
          fromName:  o.name,
          toName:    row.name,
          catalogId: row.id,
        });
        stats.rename++;
      }
      remaining.delete(row.id);
      continue;
    }

    // Non-UUID value — attempt to migrate slug → UUID by name heuristic.
    const matchId = matchOptionToCatalog(o.name, activeRows, catalogIds);
    if (matchId && remaining.has(matchId)) {
      const row = remaining.get(matchId)!;
      next.push({ ...o, value: row.id, name: row.name });
      entries.push({
        action:    "rewrite",
        optionId:  o.id,
        fromValue: o.value,
        fromName:  o.name,
        toValue:   row.id,
        toName:    row.name,
        catalogId: row.id,
      });
      stats.rewrite++;
      remaining.delete(row.id);
    } else {
      // Either a Zendesk-only legacy entry or a name we can't safely link.
      next.push(o);
      entries.push({ action: "keep", optionId: o.id, fromValue: o.value, fromName: o.name });
      stats.keep++;
    }
  }

  // Whatever OS rows are still unmatched get appended.
  for (const row of remaining.values()) {
    next.push({ name: row.name, value: row.id });
    entries.push({
      action:    "append",
      toValue:   row.id,
      toName:    row.name,
      catalogId: row.id,
    });
    stats.append++;
  }

  return { options: next, entries, stats };
}

/**
 * Push the full active catalog into Zendesk in one PUT — used by the backfill
 * endpoint to seed the field after migration 202 or to repair drift.
 *
 * Migrates existing slug-keyed options to use the OS UUID as the option's
 * value (in-place: same option_id, new value + name from OS). Options that
 * can't be confidently matched to an OS row are left untouched.
 */
export async function backfillCatalogOptionsToZendesk(opts?: {
  client?: SupabaseClient;
  dryRun?: boolean;
}): Promise<{
  ok: boolean;
  stats: BackfillPlan["stats"];
  entries?: BackfillPlanEntry[];
  error?: string;
  skipped?: string;
}> {
  const emptyStats = { rewrite: 0, rename: 0, unchanged: 0, keep: 0, prune: 0, append: 0 };
  if (!isConfigured()) {
    return { ok: false, stats: emptyStats, skipped: "zendesk_not_configured" };
  }

  const supabase = opts?.client ?? createServiceClient();
  const { data: rows, error } = await supabase
    .from("service_catalog")
    .select("id, name")
    .is("deleted_at", null)
    .eq("is_active", true);
  if (error) return { ok: false, stats: emptyStats, error: error.message };

  const cur = await fetchFieldOptions();
  if (!cur.ok) return { ok: false, stats: emptyStats, error: cur.error };

  const plan = planCatalogBackfill(cur.options, (rows ?? []) as { id: string; name: string | null }[]);

  if (opts?.dryRun) {
    return { ok: true, stats: plan.stats, entries: plan.entries };
  }

  const put = await putFieldOptions(plan.options);
  if (!put.ok) return { ok: false, stats: plan.stats, error: put.error };

  // Persist option ids back so single-row syncs can find them quickly.
  const byValue = new Map<string, number>();
  for (const o of put.options) {
    if (o.id != null) byValue.set(o.value, o.id);
  }
  for (const e of plan.entries) {
    if (!e.catalogId) continue;
    const value = e.toValue ?? e.fromValue;
    if (!value) continue;
    const optionId = byValue.get(value);
    if (optionId == null) continue;
    await supabase
      .from("service_catalog")
      .update({ zendesk_option_id: String(optionId) })
      .eq("id", e.catalogId);
  }

  return { ok: true, stats: plan.stats, entries: plan.entries };
}

function looksLikeUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Strip a leading `(XXX)` initialism prefix. */
function stripBracketPrefix(s: string): string {
  return s.replace(/^\s*\([^)]+\)\s*/, "").trim();
}

/** Strip a trailing `(XXX)` duplicate initialism (covers OS rows like
 *  "(FES) Fire Extinguisher Service (FES)"). */
function stripBracketSuffix(s: string): string {
  return s.replace(/\s*\([^)]+\)\s*$/, "").trim();
}

/** Both ends stripped → the "base" name used for cross-system matching. */
function baseName(s: string): string {
  return stripBracketSuffix(stripBracketPrefix(s));
}

/**
 * Match a Zendesk option's display name to an OS catalog row id. Layered:
 *   1. Exact name (case-insensitive)
 *   2. normalizeTypeOfWork alias (e.g. "handyman" → "General Maintenance")
 *   3. Base-name match after stripping bracket prefix / suffix duplicates
 *      (covers "(FRC) X" vs "(FAC) X", "(ELC) X" vs "X", "Y (X)" vs "Y")
 *   4. Loose containment between bases when exactly one candidate matches
 *      (covers "(EOT) End of Tenancy Cleaning" vs "(EOT) End of Tenancy")
 *
 * Returns null when there's no confident single match — better to keep the
 * legacy option than to silently relink to the wrong row.
 */
function matchOptionToCatalog(
  optionName: string,
  catalog: { id: string; name: string }[],
  _catalogIds: Set<string>,
): string | null {
  const z = optionName?.trim();
  if (!z) return null;
  const zLower = z.toLowerCase();

  // 1. Exact name match.
  const exact = catalog.find((c) => c.name.toLowerCase() === zLower);
  if (exact) return exact.id;

  // 2. Alias-normalized match.
  const zNorm = normalizeTypeOfWork(z).toLowerCase();
  if (zNorm) {
    const byNorm = catalog.find((c) => normalizeTypeOfWork(c.name).toLowerCase() === zNorm);
    if (byNorm) return byNorm.id;
  }

  // 3. Base-name match (strip bracket prefix and trailing duplicate).
  const zBase = baseName(z).toLowerCase();
  if (zBase) {
    const byBase = catalog.find((c) => baseName(c.name).toLowerCase() === zBase);
    if (byBase) return byBase.id;
  }

  // 4. Loose containment between bases — only when exactly one candidate.
  if (zBase) {
    const candidates = catalog.filter((c) => {
      const cb = baseName(c.name).toLowerCase();
      return cb && (cb.includes(zBase) || zBase.includes(cb));
    });
    if (candidates.length === 1) return candidates[0].id;
  }

  return null;
}
