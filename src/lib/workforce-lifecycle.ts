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

export async function activateWorkforcePerson(id: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await getSupabase()
    .from("payroll_internal_costs")
    .update({
      lifecycle_stage: "active",
      recurring_approved_at: now,
      updated_at: now,
    })
    .eq("id", id);
  if (error) throw error;
}
