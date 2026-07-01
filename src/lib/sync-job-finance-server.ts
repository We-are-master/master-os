import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clientMaterialsMisallocationPatch,
  partnerMaterialsLedgerSyncPatch,
  type MaterialsLedgerRow,
} from "@/lib/repair-client-materials-allocation";
import { refreshSelfBillPayoutState } from "@/services/self-bills";
import type { Job, SelfBill } from "@/types/database";

export type SyncJobFinanceResult = {
  job: Job;
  selfBill: SelfBill | null;
  jobPatched: boolean;
  selfBillSynced: boolean;
};

async function loadExtraLedgerRows(
  admin: SupabaseClient,
  jobId: string,
): Promise<MaterialsLedgerRow[]> {
  const { data, error } = await admin
    .from("job_extra_entries")
    .select("side, extra_type, amount, allocation")
    .eq("job_id", jobId)
    .is("deleted_at", null);
  if (error) {
    if ((error as { code?: string }).code === "PGRST205") return [];
    throw error;
  }
  return (data ?? []) as MaterialsLedgerRow[];
}

/** Server-side: align job materials with ledger, refresh linked self-bill totals. */
export async function syncJobFinanceServer(
  admin: SupabaseClient,
  jobId: string,
): Promise<SyncJobFinanceResult | null> {
  const { data: jobRow, error: jobErr } = await admin.from("jobs").select("*").eq("id", jobId).maybeSingle();
  if (jobErr) throw jobErr;
  if (!jobRow) return null;

  let job = jobRow as Job;
  let jobPatched = false;

  const ledger = await loadExtraLedgerRows(admin, job.id);
  const patch =
    clientMaterialsMisallocationPatch(job, ledger) ??
    partnerMaterialsLedgerSyncPatch(job, ledger);
  if (patch && Object.keys(patch).length > 0) {
    const { data: updated, error: upErr } = await admin
      .from("jobs")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .select("*")
      .single();
    if (upErr) throw upErr;
    job = updated as Job;
    jobPatched = true;
  }

  let selfBillSynced = false;
  let selfBill: SelfBill | null = null;
  const sbId = job.self_bill_id?.trim();
  if (sbId) {
    await refreshSelfBillPayoutState(sbId, admin);
    selfBillSynced = true;
    const { data: sb, error: sbErr } = await admin.from("self_bills").select("*").eq("id", sbId).maybeSingle();
    if (sbErr) throw sbErr;
    selfBill = (sb as SelfBill) ?? null;
  }

  return { job, selfBill, jobPatched, selfBillSynced };
}
