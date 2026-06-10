import type { PayrollInternalLifecycleStage } from "@/types/database";
import { getSupabase } from "@/services/base";

/** Lifecycle stages that count toward company workforce cost and Pay Run. */
export const WORKFORCE_COST_ACTIVE_STAGES: PayrollInternalLifecycleStage[] = [
  "active",
  "needs_attention",
];

export function isWorkforceCostActive(stage: string | null | undefined): boolean {
  const s = (stage ?? "active") as PayrollInternalLifecycleStage;
  return WORKFORCE_COST_ACTIVE_STAGES.includes(s);
}

/** Only self-employed contractors get internal self-bills; employees are payroll cost only. */
export function isWorkforceSelfBillEligible(employmentType: string | null | undefined): boolean {
  return employmentType === "self_employed";
}

export function sumWorkforcePayrollAmount<T extends { amount?: number | null; lifecycle_stage?: string | null }>(
  rows: T[],
): number {
  return rows
    .filter((r) => isWorkforceCostActive(r.lifecycle_stage))
    .reduce((acc, r) => acc + Number(r.amount ?? 0), 0);
}

/** PostgREST `.or()` filter: active workforce rows only (legacy null → active). */
export const WORKFORCE_COST_ACTIVE_OR_FILTER =
  "lifecycle_stage.in.(active,needs_attention),lifecycle_stage.is.null";

/** Self-bill sync includes onboarding contractors so Drafts show accumulating SB-INT early. */
export const WORKFORCE_SELF_BILL_SYNC_OR_FILTER =
  "lifecycle_stage.in.(active,needs_attention,onboarding),lifecycle_stage.is.null";

export function isWorkforceSelfBillSyncEligible(stage: string | null | undefined): boolean {
  const s = (stage ?? "active") as PayrollInternalLifecycleStage;
  return s === "active" || s === "needs_attention" || s === "onboarding";
}

export async function activateWorkforcePerson(id: string): Promise<void> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const { data: row, error: readErr } = await supabase
    .from("payroll_internal_costs")
    .select("employment_type")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw readErr;

  const { error } = await supabase
    .from("payroll_internal_costs")
    .update({
      lifecycle_stage: "active",
      recurring_approved_at: now,
      updated_at: now,
    })
    .eq("id", id);
  if (error) throw error;

  if (isWorkforceSelfBillEligible(row?.employment_type)) {
    void fetch("/api/workforce/sync-self-bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personId: id }),
    }).catch((e) => console.error("workforce self-bill sync after activate:", e));
  }
}
