/**
 * Hosted DBs that lag behind repo migrations (e.g. Railway without running SQL files)
 * can set `NEXT_PUBLIC_LEGACY_JOB_SCHEMA=true` on the frontend deploy so writes and
 * filtered selects avoid columns / enum values PostgREST does not know about.
 *
 * Inserts/updates also **auto-retry** with `applyJobDbCompat` when PostgREST returns a
 * missing-column or check-constraint error, so Vercel works even if this env is unset.
 *
 * Applies to browser + API routes (Next inlines NEXT_PUBLIC_* at build time).
 */
export function isLegacyJobSchema(): boolean {
  return process.env.NEXT_PUBLIC_LEGACY_JOB_SCHEMA === "true";
}

/** Newer `jobs` columns absent on some production DBs — strip + map status for compat. */
const JOB_DB_COMPAT_STRIP_KEYS = [
  "quote_id",
  "scheduled_finish_date",
  "extras_amount",
  "partner_ids",
  "client_address_id",
] as const;

function mapUnassignedStatus(status: unknown): unknown {
  return status === "unassigned" ? "scheduled" : status;
}

/** Slim row for older Postgres / PostgREST schema cache (used on retry and when legacy env is on). */
export function applyJobDbCompat(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const k of JOB_DB_COMPAT_STRIP_KEYS) delete out[k];
  if ("status" in out) out.status = mapUnassignedStatus(out.status);
  return out;
}

function mapStatusForLegacyEnvOnly(status: unknown): unknown {
  if (!isLegacyJobSchema()) return status;
  return mapUnassignedStatus(status);
}

/** Full row going to `jobs.insert` */
export function prepareJobRowForInsert(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  if (!isLegacyJobSchema()) return out;
  for (const k of JOB_DB_COMPAT_STRIP_KEYS) delete out[k];
  if ("status" in out) out.status = mapStatusForLegacyEnvOnly(out.status);
  return out;
}

/** Partial row for `jobs.update` */
export function prepareJobRowForUpdate(patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...patch };
  if (!isLegacyJobSchema()) return out;
  for (const k of JOB_DB_COMPAT_STRIP_KEYS) {
    if (k in out) delete out[k];
  }
  if ("status" in out) out.status = mapStatusForLegacyEnvOnly(out.status);
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
