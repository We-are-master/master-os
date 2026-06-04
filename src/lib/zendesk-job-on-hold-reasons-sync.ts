/**
 * Mirror OS on-hold reason presets into the Zendesk dropdown ticket field.
 * Option `value` = preset `id` (e.g. complaint); `name` = label shown in Zendesk.
 */

import { createServiceClient } from "@/lib/supabase/service";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeJobOnHoldPresets,
  resolveJobOnHoldPresets,
  type FrontendSetup,
} from "@/lib/frontend-setup";
import type { JobOnHoldPresetRow } from "@/lib/job-on-hold-reasons";
import { resolveZendeskComplaintFieldIds, zendeskOnHoldReasonFieldConfigured } from "@/lib/zendesk-field-ids";
import { fromZendeskTag, toZendeskTag } from "@/lib/zendesk-reason-tags";

const SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN?.trim();
const EMAIL = process.env.ZENDESK_EMAIL?.trim();
const API_TOKEN = process.env.ZENDESK_API_TOKEN?.trim();

interface ZendeskFieldOption {
  id?: number;
  name: string;
  value: string;
  position?: number;
}

function isApiConfigured(): boolean {
  return Boolean(SUBDOMAIN && EMAIL && API_TOKEN);
}

function authHeader(): string {
  return "Basic " + Buffer.from(`${EMAIL}/token:${API_TOKEN}`).toString("base64");
}

function fieldUrl(fieldId: number): string {
  return `https://${SUBDOMAIN}.zendesk.com/api/v2/ticket_fields/${fieldId}.json`;
}

async function fetchFieldOptions(fieldId: number): Promise<
  { ok: true; options: ZendeskFieldOption[] } | { ok: false; error: string }
> {
  const res = await fetch(fieldUrl(fieldId), {
    method: "GET",
    headers: { Authorization: authHeader(), Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `zendesk GET ${res.status}: ${body.slice(0, 300)}` };
  }
  const data = (await res.json()) as { ticket_field?: { custom_field_options?: ZendeskFieldOption[] } };
  return { ok: true, options: data.ticket_field?.custom_field_options ?? [] };
}

async function putFieldOptions(
  fieldId: number,
  options: ZendeskFieldOption[],
): Promise<{ ok: true; options: ZendeskFieldOption[] } | { ok: false; error: string }> {
  const res = await fetch(fieldUrl(fieldId), {
    method: "PUT",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ ticket_field: { custom_field_options: options } }),
  });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `zendesk PUT ${res.status}: ${body.slice(0, 300)}` };
  }
  const data = (await res.json()) as { ticket_field?: { custom_field_options?: ZendeskFieldOption[] } };
  return { ok: true, options: data.ticket_field?.custom_field_options ?? [] };
}

function looksLikeHoldZendeskTag(v: string): boolean {
  return v.trim().startsWith("hold_");
}

export type OnHoldPresetBackfillEntry = {
  action: "unchanged" | "rename" | "prune" | "append" | "keep";
  presetId?: string;
  fromName?: string;
  toName?: string;
};

export function planOnHoldPresetsBackfill(
  zendeskOptions: ZendeskFieldOption[],
  presets: JobOnHoldPresetRow[],
): {
  options: ZendeskFieldOption[];
  entries: OnHoldPresetBackfillEntry[];
  stats: { unchanged: number; rename: number; prune: number; append: number; keep: number };
} {
  const active = normalizeJobOnHoldPresets(presets);
  const presetIds = new Set(active.map((p) => p.id));
  const remaining = new Map(active.map((p) => [p.id, p] as const));

  const entries: OnHoldPresetBackfillEntry[] = [];
  const next: ZendeskFieldOption[] = [];
  const stats = { unchanged: 0, rename: 0, prune: 0, append: 0, keep: 0 };

  for (const o of zendeskOptions) {
    const value = o.value?.trim() ?? "";
    const osId = fromZendeskTag(value, "hold");
    const row = remaining.get(osId);
    if (row) {
      const tag = toZendeskTag(row.id, "hold");
      if (o.name === row.label && o.value === tag) {
        next.push(o);
        entries.push({ action: "unchanged", presetId: row.id, fromName: o.name });
        stats.unchanged++;
      } else {
        next.push({ ...o, name: row.label, value: tag });
        entries.push({ action: "rename", presetId: row.id, fromName: o.name, toName: row.label });
        stats.rename++;
      }
      remaining.delete(row.id);
      continue;
    }
    if (looksLikeHoldZendeskTag(value) && !presetIds.has(osId)) {
      entries.push({ action: "prune", presetId: osId || value, fromName: o.name });
      stats.prune++;
      continue;
    }
    next.push(o);
    entries.push({ action: "keep", fromName: o.name });
    stats.keep++;
  }

  for (const row of remaining.values()) {
    next.push({ name: row.label, value: toZendeskTag(row.id, "hold") });
    entries.push({ action: "append", presetId: row.id, toName: row.label });
    stats.append++;
  }

  return { options: next, entries, stats };
}

export interface OnHoldPresetsZendeskSyncResult {
  ok: boolean;
  fieldId?: number;
  stats?: ReturnType<typeof planOnHoldPresetsBackfill>["stats"];
  entries?: OnHoldPresetBackfillEntry[];
  error?: string;
  skipped?: string;
}

/**
 * Push the current OS on-hold preset list into the Zendesk dropdown field.
 * Called after Settings save and from the admin sync endpoint.
 */
export async function backfillOnHoldPresetsToZendesk(opts?: {
  presets?: JobOnHoldPresetRow[];
  setup?: FrontendSetup | null;
  client?: SupabaseClient;
  dryRun?: boolean;
}): Promise<OnHoldPresetsZendeskSyncResult> {
  const emptyStats = { unchanged: 0, rename: 0, prune: 0, append: 0, keep: 0 };
  if (!isApiConfigured()) {
    return { ok: false, stats: emptyStats, skipped: "zendesk_api_not_configured" };
  }

  const setup = opts?.setup;
  if (!zendeskOnHoldReasonFieldConfigured(setup)) {
    return { ok: false, stats: emptyStats, skipped: "on_hold_reason_field_id_not_configured" };
  }

  const fieldId = resolveZendeskComplaintFieldIds(setup).onHoldReasonFieldId;
  const presets =
    opts?.presets
    ?? resolveJobOnHoldPresets(setup ?? null)
    ?? normalizeJobOnHoldPresets(null);

  const cur = await fetchFieldOptions(fieldId);
  if (!cur.ok) return { ok: false, stats: emptyStats, error: cur.error, fieldId };

  const plan = planOnHoldPresetsBackfill(cur.options, presets);
  if (opts?.dryRun) {
    return { ok: true, fieldId, stats: plan.stats, entries: plan.entries };
  }

  const put = await putFieldOptions(fieldId, plan.options);
  if (!put.ok) return { ok: false, stats: plan.stats, error: put.error, fieldId };

  return { ok: true, fieldId, stats: plan.stats, entries: plan.entries };
}

/** Load presets from company_settings and sync to Zendesk. */
export async function backfillOnHoldPresetsFromCompanySettings(opts?: {
  client?: SupabaseClient;
  dryRun?: boolean;
}): Promise<OnHoldPresetsZendeskSyncResult> {
  const supabase = opts?.client ?? createServiceClient();
  const { data, error } = await supabase
    .from("company_settings")
    .select("frontend_setup")
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const setup = (data?.frontend_setup ?? null) as FrontendSetup | null;
  return backfillOnHoldPresetsToZendesk({ setup, client: supabase, dryRun: opts?.dryRun });
}
