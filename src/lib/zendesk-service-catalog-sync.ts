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

/**
 * Push the full active catalog into Zendesk in one PUT — used by the backfill
 * endpoint to seed the field after migration 202 or to repair drift. Only
 * touches options whose `value` matches a known catalog UUID; other options
 * on the field are left untouched.
 */
export async function backfillCatalogOptionsToZendesk(opts?: {
  client?: SupabaseClient;
  dryRun?: boolean;
}): Promise<{
  ok: boolean;
  inserted: number;
  updated: number;
  unchanged: number;
  pruned: number;
  error?: string;
  skipped?: string;
}> {
  const empty = { inserted: 0, updated: 0, unchanged: 0, pruned: 0 };
  if (!isConfigured()) {
    return { ok: false, ...empty, skipped: "zendesk_not_configured" };
  }

  const supabase = opts?.client ?? createServiceClient();
  const { data: rows, error } = await supabase
    .from("service_catalog")
    .select("id, name")
    .is("deleted_at", null)
    .eq("is_active", true);
  if (error) return { ok: false, ...empty, error: error.message };
  const catalog = (rows ?? []) as { id: string; name: string | null }[];
  const wantByValue = new Map<string, string>();
  for (const c of catalog) {
    const name = c.name?.trim();
    if (name) wantByValue.set(c.id, name);
  }

  const cur = await fetchFieldOptions();
  if (!cur.ok) return { ok: false, ...empty, error: cur.error };

  const knownIds = new Set(catalog.map((c) => c.id));
  const next: ZendeskFieldOption[] = [];
  const stats = { inserted: 0, updated: 0, unchanged: 0, pruned: 0 };

  // Pass 1 — walk existing options, update name when needed, prune
  // soft-deleted rows. Options whose value isn't a catalog UUID are kept
  // untouched (manual entries Zendesk owns).
  for (const o of cur.options) {
    const want = wantByValue.get(o.value);
    if (want === undefined) {
      // Either a UUID that no longer points to a catalog row (prune), or a
      // non-UUID legacy option (keep).
      if (knownIds.has(o.value)) {
        // not reachable: knownIds was built from catalog and want would have been set
        next.push(o);
      } else if (looksLikeUuid(o.value)) {
        stats.pruned++;
        continue;
      } else {
        next.push(o);
      }
    } else if (o.name === want) {
      next.push(o);
      stats.unchanged++;
      wantByValue.delete(o.value);
    } else {
      next.push({ ...o, name: want });
      stats.updated++;
      wantByValue.delete(o.value);
    }
  }

  // Pass 2 — append everything that's still missing.
  for (const [value, name] of wantByValue) {
    next.push({ name, value });
    stats.inserted++;
  }

  if (opts?.dryRun) {
    return { ok: true, ...stats };
  }

  const put = await putFieldOptions(next);
  if (!put.ok) return { ok: false, ...stats, error: put.error };

  // Persist option ids back so single-row syncs can find them quickly.
  const byValue = new Map<string, number>();
  for (const o of put.options) {
    if (o.id != null) byValue.set(o.value, o.id);
  }
  for (const c of catalog) {
    const id = byValue.get(c.id);
    if (id == null) continue;
    await supabase
      .from("service_catalog")
      .update({ zendesk_option_id: String(id) })
      .eq("id", c.id);
  }

  return { ok: true, ...stats };
}

function looksLikeUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
