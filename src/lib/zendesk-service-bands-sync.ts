/**
 * Mirror service_catalog.pricing_presets (bands) into per-service Zendesk dropdown fields.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import {
  BAND_FIELD_BY_SERVICE_ID,
  fromZendeskBandTag,
  toZendeskBandTag,
  zendeskBandFieldIdForCatalog,
} from "@/lib/zendesk-os-catalog-mapping";
import {
  parsePricingPresets,
  sortPricingPresetsDisplay,
  type ServicePricingPreset,
} from "@/lib/catalog-pricing-presets";
import {
  fetchZendeskTicketFieldOptions,
  isZendeskApiConfigured,
  putZendeskTicketFieldOptions,
  type ZendeskFieldOption,
} from "@/lib/zendesk-ticket-field-api";

/** @deprecated Use BAND_FIELD_BY_SERVICE_ID from zendesk-os-catalog-mapping */
export const ZENDESK_BAND_FIELD_BY_CATALOG_ID = BAND_FIELD_BY_SERVICE_ID;

export function bandIdToZendeskTag(presetId: string): string {
  return toZendeskBandTag(presetId);
}

export function zendeskTagToBandId(tag: string): string | null {
  return fromZendeskBandTag(tag);
}

export function formatBandZendeskOptionName(
  preset: Pick<ServicePricingPreset, "label" | "fixed_price">,
): string {
  const label = preset.label?.trim() || "Band";
  const price = Number(preset.fixed_price);
  if (Number.isFinite(price) && price > 0) {
    return `${label} - £${price.toFixed(2)}`;
  }
  return label;
}

export function planBandsZendeskSync(
  zendeskOptions: ZendeskFieldOption[],
  presets: ServicePricingPreset[],
): {
  options: ZendeskFieldOption[];
  stats: { unchanged: number; rename: number; prune: number; append: number; keep: number };
} {
  const active = sortPricingPresetsDisplay(presets);
  const remaining = new Map(active.map((p) => [p.id, p] as const));
  const next: ZendeskFieldOption[] = [];
  const stats = { unchanged: 0, rename: 0, prune: 0, append: 0, keep: 0 };

  for (const o of zendeskOptions) {
    const value = o.value?.trim() ?? "";
    const presetId = zendeskTagToBandId(value);
    const row = presetId ? remaining.get(presetId) : undefined;
    if (row) {
      const tag = bandIdToZendeskTag(row.id);
      const name = formatBandZendeskOptionName(row);
      if (o.name === name && o.value === tag) {
        next.push(o);
        stats.unchanged++;
      } else {
        next.push({ ...o, name, value: tag });
        stats.rename++;
      }
      remaining.delete(row.id);
      continue;
    }
    if (presetId && !active.some((p) => p.id === presetId)) {
      stats.prune++;
      continue;
    }
    next.push(o);
    stats.keep++;
  }

  for (const row of remaining.values()) {
    next.push({
      name: formatBandZendeskOptionName(row),
      value: bandIdToZendeskTag(row.id),
    });
    stats.append++;
  }

  return { options: next, stats };
}

export type ServiceBandsZendeskSyncResult = {
  ok: boolean;
  skipped?: string;
  error?: string;
  stats?: ReturnType<typeof planBandsZendeskSync>["stats"];
};

export async function syncBandsToZendesk(
  catalogServiceId: string,
  presetsRaw: unknown,
  opts?: { client?: SupabaseClient },
): Promise<ServiceBandsZendeskSyncResult> {
  const fieldId = zendeskBandFieldIdForCatalog(catalogServiceId);
  if (!fieldId) {
    return { ok: true, skipped: "no_zendesk_band_field_for_service" };
  }
  if (!isZendeskApiConfigured()) {
    return { ok: false, skipped: "zendesk_not_configured" };
  }

  const presets = sortPricingPresetsDisplay(parsePricingPresets(presetsRaw));
  const cur = await fetchZendeskTicketFieldOptions(fieldId);
  if (!cur.ok) return { ok: false, error: cur.error };

  const plan = planBandsZendeskSync(cur.data, presets);
  const put = await putZendeskTicketFieldOptions(fieldId, plan.options);
  if (!put.ok) return { ok: false, error: put.error, stats: plan.stats };

  return { ok: true, stats: plan.stats };
}

export async function backfillAllBandsToZendesk(opts?: {
  client?: SupabaseClient;
  dryRun?: boolean;
}): Promise<{
  ok: boolean;
  results: Record<string, ServiceBandsZendeskSyncResult>;
  error?: string;
}> {
  const supabase = opts?.client ?? createServiceClient();
  const catalogIds = Object.keys(BAND_FIELD_BY_SERVICE_ID);
  const results: Record<string, ServiceBandsZendeskSyncResult> = {};

  const { data: rows, error } = await supabase
    .from("service_catalog")
    .select("id, pricing_presets")
    .in("id", catalogIds)
    .is("deleted_at", null);
  if (error) return { ok: false, results, error: error.message };

  for (const catalogId of catalogIds) {
    const row = (rows ?? []).find((r) => (r as { id: string }).id === catalogId) as
      | { id: string; pricing_presets: unknown }
      | undefined;
    if (opts?.dryRun) {
      const presets = sortPricingPresetsDisplay(parsePricingPresets(row?.pricing_presets));
      results[catalogId] = {
        ok: true,
        stats: { unchanged: 0, rename: 0, prune: 0, append: presets.length, keep: 0 },
      };
      continue;
    }
    results[catalogId] = await syncBandsToZendesk(catalogId, row?.pricing_presets ?? [], {
      client: supabase,
    });
  }

  const anyFail = Object.values(results).some((r) => !r.ok && !r.skipped);
  return { ok: !anyFail, results };
}
