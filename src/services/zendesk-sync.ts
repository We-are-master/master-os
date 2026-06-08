/**
 * Unified entry point: sync OS hold / cancellation reason presets → Zendesk dropdowns.
 *
 * Uses merge/backfill (GET → plan → PUT) so non-OS Zendesk options are preserved.
 * Tag values: `hold_{osId}` / `cancel_{osId}`.
 */

import type { FrontendSetup } from "@/lib/frontend-setup";
import type { JobOnHoldPresetRow } from "@/lib/job-on-hold-reasons";
import type { OfficeJobCancellationPresetRow } from "@/lib/frontend-setup";
import {
  backfillCancellationPresetsToZendesk,
  type CancellationPresetsZendeskSyncResult,
} from "@/lib/zendesk-cancellation-reasons-sync";
import {
  backfillOnHoldPresetsToZendesk,
  type OnHoldPresetsZendeskSyncResult,
} from "@/lib/zendesk-job-on-hold-reasons-sync";

export type ReasonType = "hold" | "cancel";

export type ReasonRow = { id: string; label: string };

export type ZendeskReasonSyncResult = CancellationPresetsZendeskSyncResult | OnHoldPresetsZendeskSyncResult;

/**
 * Sync OS reasons to the corresponding Zendesk dropdown field.
 * Call after admin adds/edits/removes presets in Settings → Setup.
 */
export async function syncReasonsToZendesk(
  type: ReasonType,
  reasons: ReasonRow[],
  opts?: {
    setup?: FrontendSetup | null;
    dryRun?: boolean;
  },
): Promise<ZendeskReasonSyncResult> {
  const dryRun = opts?.dryRun === true;
  const setup = opts?.setup ?? null;

  if (type === "hold") {
    const presets: JobOnHoldPresetRow[] = reasons.map((r) => ({ id: r.id, label: r.label }));
    const result = await backfillOnHoldPresetsToZendesk({ presets, setup, dryRun });
    console.log("[zendesk-sync] hold", {
      ok: result.ok,
      fieldId: result.fieldId,
      stats: result.stats,
      skipped: result.skipped,
      error: result.error,
    });
    return result;
  }

  const presets: OfficeJobCancellationPresetRow[] = reasons.map((r) => ({
    id: r.id,
    label: r.label,
  }));
  const result = await backfillCancellationPresetsToZendesk({ presets, setup, dryRun });
  console.log("[zendesk-sync] cancel", {
    ok: result.ok,
    fieldId: result.fieldId,
    stats: result.stats,
    skipped: result.skipped,
    error: result.error,
  });
  return result;
}
