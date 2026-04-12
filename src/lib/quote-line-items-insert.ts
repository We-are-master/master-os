import { getErrorMessage } from "@/lib/utils";
import { isPostgrestWriteRetryableError } from "@/lib/postgrest-errors";
import {
  isSupabaseMissingColumnError,
  parsePostgrestUnknownColumnName,
  postgrestFullErrorText,
} from "@/lib/supabase-schema-compat";
import type { SupabaseClient } from "@supabase/supabase-js";

export type QuoteLineItemInsertRow = {
  quote_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  sort_order: number;
  partner_unit_cost: number;
  notes: string | null;
};

function isUnknownColumnSchemaError(err: unknown): boolean {
  if (isPostgrestWriteRetryableError(err)) return true;
  return isSupabaseMissingColumnError(err);
}

function stripColumnFromRows(payload: Record<string, unknown>[], col: string): Record<string, unknown>[] {
  return payload.map((p) => {
    if (!(col in p)) return p;
    const { [col]: _, ...rest } = p;
    return rest;
  });
}

/**
 * Inserts quote line rows, retrying with slimmer payloads if PostgREST reports unknown columns
 * (e.g. remote DB missing migrations `066_quote_line_items_notes` / `067_quote_line_items_partner_unit_cost`).
 */
export async function insertQuoteLineItemsResilient(
  supabase: SupabaseClient,
  rows: QuoteLineItemInsertRow[],
): Promise<void> {
  if (rows.length === 0) return;

  let payload: Record<string, unknown>[] = rows.map((r) => ({ ...r }));

  for (let attempt = 0; attempt < 24; attempt++) {
    const ins = await supabase.from("quote_line_items").insert(payload);
    if (!ins.error) return;

    const err = ins.error;
    if (!isUnknownColumnSchemaError(err)) throw err;

    const col = parsePostgrestUnknownColumnName(err);
    const msg = getErrorMessage(err, "") + postgrestFullErrorText(err);
    if (col && payload[0] && col in payload[0]) {
      payload = stripColumnFromRows(payload, col);
      continue;
    }
    const t = msg.toLowerCase();
    if (
      t.includes("quote_line_items") ||
      t.includes("partner_unit_cost") ||
      t.includes("notes")
    ) {
      const slim = payload.map((p) => {
        const { notes: _n, partner_unit_cost: _p, ...rest } = p;
        return rest;
      });
      if (JSON.stringify(slim) !== JSON.stringify(payload)) {
        payload = slim;
        continue;
      }
    }

    throw err;
  }

  throw new Error("Could not insert quote line items: exhausted schema fallbacks");
}
