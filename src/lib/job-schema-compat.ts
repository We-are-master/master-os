/**
 * Hosted DBs that lag behind repo migrations (e.g. Railway without running SQL files)
 * can set `NEXT_PUBLIC_LEGACY_JOB_SCHEMA=true` on the frontend deploy so writes and
 * filtered selects avoid columns / enum values PostgREST does not know about.
 *
 * Applies to browser + API routes (Next inlines NEXT_PUBLIC_* at build time).
 */
export function isLegacyJobSchema(): boolean {
  return process.env.NEXT_PUBLIC_LEGACY_JOB_SCHEMA === "true";
}

const LEGACY_STRIP_JOB_KEYS = ["scheduled_finish_date", "quote_id"] as const;

function mapStatusForLegacyDb(status: unknown): unknown {
  if (!isLegacyJobSchema()) return status;
  return status === "unassigned" ? "scheduled" : status;
}

/** Full row going to `jobs.insert` */
export function prepareJobRowForInsert(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  if (!isLegacyJobSchema()) return out;
  for (const k of LEGACY_STRIP_JOB_KEYS) delete out[k];
  if ("status" in out) out.status = mapStatusForLegacyDb(out.status);
  return out;
}

/** Partial row for `jobs.update` */
export function prepareJobRowForUpdate(patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...patch };
  if (!isLegacyJobSchema()) return out;
  for (const k of LEGACY_STRIP_JOB_KEYS) {
    if (k in out) delete out[k];
  }
  if ("status" in out) out.status = mapStatusForLegacyDb(out.status);
  return out;
}

/** Dashboard job list select — avoid unknown columns in PostgREST select list. */
export function dashboardJobsFilterSelectColumns(): string {
  return isLegacyJobSchema()
    ? "id, status, partner_id, partner_name, margin_percent, finance_status, report_submitted, commission, created_at"
    : "id, status, partner_id, partner_name, quote_id, margin_percent, finance_status, report_submitted, commission, created_at";
}

/** Client profile job history select */
export function clientsJobHistorySelectColumns(): string {
  return isLegacyJobSchema()
    ? "id, reference, title, status, client_price, customer_deposit_paid, customer_final_payment, scheduled_date, scheduled_start_at, scheduled_end_at, property_address, partner_name, job_type"
    : "id, reference, title, status, client_price, customer_deposit_paid, customer_final_payment, scheduled_date, scheduled_start_at, scheduled_end_at, scheduled_finish_date, property_address, partner_name, job_type";
}
