import type { SupabaseClient } from "@supabase/supabase-js";
import { isPostgrestWriteRetryableError } from "@/lib/postgrest-errors";

function omit(row: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out = { ...row };
  for (const k of keys) delete out[k];
  return out;
}

const KEYS_093: string[] = [
  "lifecycle_stage",
  "has_equity",
  "equity_percent",
  "equity_vesting_notes",
  "equity_start_date",
  "payroll_profile",
];

const KEYS_092: string[] = ["pay_frequency", "payroll_document_files"];

export type PayrollInternalInsertResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
  /** 0 = full row, higher = older schema fallback */
  compatLevel: number;
};

/**
 * Inserts into `payroll_internal_costs`, retrying with fewer columns when PostgREST returns
 * missing-column / check errors (hosted DBs often lag behind repo migrations).
 */
export async function insertPayrollInternalCostWithCompat(
  supabase: SupabaseClient,
  fullRow: Record<string, unknown>,
): Promise<PayrollInternalInsertResult> {
  const attempts: { row: Record<string, unknown>; level: number }[] = [
    { row: fullRow, level: 0 },
    { row: omit(fullRow, ["bu_id"]), level: 1 },
    { row: omit(fullRow, [...KEYS_093, "bu_id"]), level: 2 },
    { row: omit(fullRow, KEYS_093), level: 3 },
    {
      row: {
        ...omit(fullRow, [...KEYS_092, ...KEYS_093, "bu_id"]),
        documents_on_file: {},
      },
      level: 4,
    },
    {
      row: {
        ...omit(fullRow, [...KEYS_092, ...KEYS_093]),
        documents_on_file: {},
      },
      level: 5,
    },
    {
      row: {
        description: fullRow.description,
        amount: fullRow.amount,
        category: fullRow.category ?? null,
        due_date: fullRow.due_date ?? null,
        payee_name: fullRow.payee_name ?? null,
        employment_type: fullRow.employment_type ?? null,
        payment_day_of_month: fullRow.payment_day_of_month ?? null,
        documents_on_file: {},
        status: fullRow.status ?? "pending",
        paid_at: fullRow.paid_at ?? null,
        created_at: fullRow.created_at,
        updated_at: fullRow.updated_at,
      },
      level: 6,
    },
  ];

  const seen = new Set<string>();
  let lastErr: { message: string; code?: string } | null = null;

  for (const { row, level } of attempts) {
    const key = JSON.stringify(Object.keys(row).sort());
    if (seen.has(key)) continue;
    seen.add(key);

    const { data, error } = await supabase.from("payroll_internal_costs").insert(row).select("*").single();
    if (!error) {
      return { data, error: null, compatLevel: level };
    }
    const msg = error.message ?? String(error);
    const code = typeof (error as { code?: string }).code === "string" ? (error as { code: string }).code : undefined;
    lastErr = { message: msg, code };
    if (!isPostgrestWriteRetryableError(error)) {
      break;
    }
  }

  return { data: null, error: lastErr, compatLevel: -1 };
}
