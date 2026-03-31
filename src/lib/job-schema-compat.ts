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
  "catalog_service_id",
  "hourly_client_rate",
  "hourly_partner_rate",
  "billed_hours",
] as const;

/**
 * Migration `070_job_operational_flow` columns. If the DB was not migrated, PostgREST returns 400 on PATCH.
 * Stripped by default; set `NEXT_PUBLIC_JOB_OPERATIONAL_SCHEMA=true` after applying 070 to persist reports/timers.
 */
const JOB_OPERATIONAL_FLOW_STRIP_KEYS = [
  "start_report",
  "start_report_submitted",
  "start_report_skipped",
  "final_report",
  "final_report_submitted",
  "final_report_skipped",
  "timer_elapsed_seconds",
  "timer_last_started_at",
  "timer_is_running",
  "review_sent_at",
  "review_send_method",
  "internal_report_approved",
  "internal_invoice_approved",
  "operational_checklist",
] as const;

/** When true, operational-flow columns are sent on insert/update (requires DB migration 070). */
export function isJobOperationalSchemaEnabled(): boolean {
  return process.env.NEXT_PUBLIC_JOB_OPERATIONAL_SCHEMA === "true";
}

function stripOperationalFlowKeysIfDisabled(out: Record<string, unknown>): void {
  if (isJobOperationalSchemaEnabled()) return;
  for (const k of JOB_OPERATIONAL_FLOW_STRIP_KEYS) {
    if (k in out) delete out[k];
  }
}

function mapUnassignedStatus(status: unknown): unknown {
  if (status === "unassigned" || status === "auto_assigning") return "scheduled";
  return status;
}

/** Slim row for older Postgres / PostgREST schema cache (used on retry and when legacy env is on). */
export function applyJobDbCompat(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const k of JOB_DB_COMPAT_STRIP_KEYS) delete out[k];
  if ("status" in out) out.status = mapUnassignedStatus(out.status);
  stripOperationalFlowKeysIfDisabled(out);
  return out;
}

function mapStatusForLegacyEnvOnly(status: unknown): unknown {
  if (!isLegacyJobSchema()) return status;
  return mapUnassignedStatus(status);
}

/** Full row going to `jobs.insert` */
export function prepareJobRowForInsert(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  if (isLegacyJobSchema()) {
    for (const k of JOB_DB_COMPAT_STRIP_KEYS) delete out[k];
    if ("status" in out) out.status = mapStatusForLegacyEnvOnly(out.status);
  }
  stripOperationalFlowKeysIfDisabled(out);
  return out;
}

/** Partial row for `jobs.update` */
export function prepareJobRowForUpdate(patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...patch };
  if (isLegacyJobSchema()) {
    for (const k of JOB_DB_COMPAT_STRIP_KEYS) {
      if (k in out) delete out[k];
    }
    if ("status" in out) out.status = mapStatusForLegacyEnvOnly(out.status);
  }
  stripOperationalFlowKeysIfDisabled(out);
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
