import { isSupabaseMissingColumnError } from "@/lib/supabase-schema-compat";

/**
 * Colunas da mig 349. Banco sem ela: grava o resto (o dinheiro da visita está em
 * client_price / partner_cost, que já existem) e solta só estas.
 */
export const VISIT_RATE_COLUMNS = [
  "job_type", "hourly_client_rate", "hourly_partner_rate", "billed_hours", "arrived_at", "departed_at", "materials_receipts",
] as const;

export function withoutRateColumns(patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...patch };
  for (const c of VISIT_RATE_COLUMNS) delete out[c];
  return out;
}

export function isMissingRateColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return VISIT_RATE_COLUMNS.some((c) => isSupabaseMissingColumnError(error, c));
}
