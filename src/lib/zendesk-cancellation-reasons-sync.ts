/**
 * Mirror OS office cancellation reason presets into the Zendesk dropdown field.
 * Option `value` = `cancel_{osId}`; `name` = label shown in Zendesk.
 */

import { createServiceClient } from "@/lib/supabase/service";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeOfficeJobCancellationPresets,
  resolveOfficeJobCancellationPresets,
  type FrontendSetup,
  type OfficeJobCancellationPresetRow,
} from "@/lib/frontend-setup";
import { officeCancelIdToZendeskTag } from "@/lib/zendesk-cancellation-tags";
import { resolveZendeskCancellationFieldIds, zendeskCancellationReasonFieldConfigured } from "@/lib/zendesk-field-ids";
import {
  fetchZendeskTicketFieldOptions,
  isZendeskApiConfigured,
  putZendeskTicketFieldOptions,
  type ZendeskFieldOption,
} from "@/lib/zendesk-ticket-field-api";

function looksLikeOsCancelTag(v: string): boolean {
  return v.trim().startsWith("cancel_");
}

export type CancellationPresetBackfillEntry = {
  action: "unchanged" | "rename" | "prune" | "append" | "keep";
  presetId?: string;
  zendeskValue?: string;
  fromName?: string;
  toName?: string;
};

export function planCancellationPresetsBackfill(
  zendeskOptions: ZendeskFieldOption[],
  presets: OfficeJobCancellationPresetRow[],
): {
  options: ZendeskFieldOption[];
  entries: CancellationPresetBackfillEntry[];
  stats: { unchanged: number; rename: number; prune: number; append: number; keep: number };
} {
  const active = normalizeOfficeJobCancellationPresets(presets);
  const presetById = new Map(active.map((p) => [p.id, p] as const));
  const remaining = new Map(active.map((p) => [p.id, p] as const));

  const entries: CancellationPresetBackfillEntry[] = [];
  const next: ZendeskFieldOption[] = [];
  const stats = { unchanged: 0, rename: 0, prune: 0, append: 0, keep: 0 };

  for (const o of zendeskOptions) {
    const value = o.value?.trim() ?? "";
    const osId = value.startsWith("cancel_") ? value.slice("cancel_".length) : "";
    const row = osId ? remaining.get(osId) : undefined;
    if (row) {
      const tag = officeCancelIdToZendeskTag(row.id);
      if (o.name === row.label && o.value === tag) {
        next.push(o);
        entries.push({ action: "unchanged", presetId: row.id, zendeskValue: tag, fromName: o.name });
        stats.unchanged++;
      } else {
        next.push({ ...o, name: row.label, value: tag });
        entries.push({
          action: "rename",
          presetId: row.id,
          zendeskValue: tag,
          fromName: o.name,
          toName: row.label,
        });
        stats.rename++;
      }
      remaining.delete(row.id);
      continue;
    }
    if (looksLikeOsCancelTag(value) && !presetById.has(osId)) {
      entries.push({ action: "prune", presetId: osId || value, fromName: o.name, zendeskValue: value });
      stats.prune++;
      continue;
    }
    next.push(o);
    entries.push({ action: "keep", fromName: o.name, zendeskValue: value });
    stats.keep++;
  }

  for (const row of remaining.values()) {
    const tag = officeCancelIdToZendeskTag(row.id);
    next.push({ name: row.label, value: tag });
    entries.push({ action: "append", presetId: row.id, zendeskValue: tag, toName: row.label });
    stats.append++;
  }

  return { options: next, entries, stats };
}

export interface CancellationPresetsZendeskSyncResult {
  ok: boolean;
  fieldId?: number;
  stats?: ReturnType<typeof planCancellationPresetsBackfill>["stats"];
  entries?: CancellationPresetBackfillEntry[];
  error?: string;
  skipped?: string;
}

export async function backfillCancellationPresetsToZendesk(opts?: {
  presets?: OfficeJobCancellationPresetRow[];
  setup?: FrontendSetup | null;
  client?: SupabaseClient;
  dryRun?: boolean;
}): Promise<CancellationPresetsZendeskSyncResult> {
  const emptyStats = { unchanged: 0, rename: 0, prune: 0, append: 0, keep: 0 };
  if (!isZendeskApiConfigured()) {
    return { ok: false, stats: emptyStats, skipped: "zendesk_api_not_configured" };
  }

  const setup = opts?.setup;
  if (!zendeskCancellationReasonFieldConfigured(setup)) {
    return { ok: false, stats: emptyStats, skipped: "cancellation_reason_field_id_not_configured" };
  }

  const fieldId = resolveZendeskCancellationFieldIds(setup).cancellationReasonFieldId;
  const presets = [
    ...(opts?.presets
      ?? resolveOfficeJobCancellationPresets(setup ?? null)
      ?? normalizeOfficeJobCancellationPresets(null)),
  ];

  const cur = await fetchZendeskTicketFieldOptions(fieldId);
  if (!cur.ok) return { ok: false, stats: emptyStats, error: cur.error, fieldId };

  const plan = planCancellationPresetsBackfill(cur.data, presets);
  if (opts?.dryRun) {
    return { ok: true, fieldId, stats: plan.stats, entries: plan.entries };
  }

  const put = await putZendeskTicketFieldOptions(fieldId, plan.options);
  if (!put.ok) return { ok: false, stats: plan.stats, error: put.error, fieldId };

  console.log("[zendesk-cancellation-reasons-sync] PUT ok", {
    fieldId,
    stats: plan.stats,
  });

  return { ok: true, fieldId, stats: plan.stats, entries: plan.entries };
}

export async function backfillCancellationPresetsFromCompanySettings(opts?: {
  client?: SupabaseClient;
  dryRun?: boolean;
}): Promise<CancellationPresetsZendeskSyncResult> {
  const supabase = opts?.client ?? createServiceClient();
  const { data, error } = await supabase
    .from("company_settings")
    .select("frontend_setup")
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const setup = (data?.frontend_setup ?? null) as FrontendSetup | null;
  return backfillCancellationPresetsToZendesk({ setup, client: supabase, dryRun: opts?.dryRun });
}
