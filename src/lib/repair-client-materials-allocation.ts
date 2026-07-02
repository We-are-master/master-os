import type { Job } from "@/types/database";
import { deriveStoredJobFinancials } from "@/lib/job-financials";
import { isJobExtraDiscountExtraType } from "@/lib/job-extra-discount";

export type MaterialsLedgerRow = {
  side: "client" | "partner";
  extra_type: string;
  amount: number;
  allocation: string;
};

function signedMaterialsAmount(row: MaterialsLedgerRow): number {
  const a = Math.abs(Number(row.amount) || 0);
  return isJobExtraDiscountExtraType(row.extra_type) ? -a : a;
}

/** Sum signed materials ledger rows for one side. */
export function sumLedgerMaterials(rows: MaterialsLedgerRow[], side: "client" | "partner"): number {
  return rows.reduce((sum, row) => {
    if (row.side !== side || row.allocation !== "materials") return sum;
    return Math.round((sum + signedMaterialsAmount(row)) * 100) / 100;
  }, 0);
}

/**
 * When client materials were wrongly stored in `materials_cost`, return a job patch
 * that moves them to `extras_amount` and sets `materials_cost` to partner-only total.
 * Idempotent once the job row matches the ledger.
 */
export function clientMaterialsMisallocationPatch(
  job: Pick<Job, "client_price" | "extras_amount" | "materials_cost" | "partner_cost" | "customer_deposit">,
  rows: MaterialsLedgerRow[],
): Partial<Job> | null {
  const clientMaterials = sumLedgerMaterials(rows, "client");
  const partnerMaterials = Math.max(0, sumLedgerMaterials(rows, "partner"));
  if (clientMaterials <= 0.001) return null;

  const currentMaterials = Number(job.materials_cost ?? 0);
  if (Math.abs(currentMaterials - partnerMaterials) <= 0.02) return null;

  const excessInMaterials = Math.round((currentMaterials - partnerMaterials) * 100) / 100;
  if (excessInMaterials <= 0.02 || Math.abs(excessInMaterials - clientMaterials) > 0.05) return null;

  const client_price = Number(job.client_price ?? 0);
  const extras_amount = Math.round((Number(job.extras_amount ?? 0) + clientMaterials) * 100) / 100;
  const materials_cost = partnerMaterials;
  const customer_deposit = Number(job.customer_deposit ?? 0);
  const customer_final_payment =
    Math.round(Math.max(0, client_price + extras_amount - customer_deposit) * 100) / 100;
  const merged = {
    ...job,
    client_price,
    extras_amount,
    materials_cost,
    customer_deposit,
    customer_final_payment,
    partner_cost: Number(job.partner_cost ?? 0),
  } as Job;
  return {
    client_price,
    extras_amount,
    materials_cost,
    customer_final_payment,
    ...deriveStoredJobFinancials(merged),
  };
}

/**
 * When partner materials live only on the ledger, sync `materials_cost` on the job row
 * so self-bill totals and the Partner self-bill card match Cash out — partner.
 */
export function partnerMaterialsLedgerSyncPatch(
  job: Pick<Job, "materials_cost" | "partner_cost" | "client_price" | "extras_amount" | "customer_deposit">,
  rows: MaterialsLedgerRow[],
): Partial<Job> | null {
  const partnerMaterials = Math.max(0, sumLedgerMaterials(rows, "partner"));
  const currentMaterials = Number(job.materials_cost ?? 0);
  if (Math.abs(currentMaterials - partnerMaterials) <= 0.02) return null;
  const merged = { ...job, materials_cost: partnerMaterials } as Job;
  return {
    materials_cost: partnerMaterials,
    ...deriveStoredJobFinancials(merged),
  };
}
