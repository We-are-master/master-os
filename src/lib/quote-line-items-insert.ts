import { getErrorMessage } from "@/lib/utils";
import { isPostgrestWriteRetryableError } from "@/lib/postgrest-errors";
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
  const msg = getErrorMessage(err, "");
  return msg.includes("PGRST204") || msg.includes("schema cache") || /Could not find the .+ column/i.test(msg);
}

function stripNotes(payload: Record<string, unknown>[]) {
  return payload.map((p) => {
    const { notes: _n, ...rest } = p;
    return rest;
  });
}

function stripPartnerUnitCost(payload: Record<string, unknown>[]) {
  return payload.map((p) => {
    const { partner_unit_cost: _c, ...rest } = p;
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

  for (let attempt = 0; attempt < 8; attempt++) {
    const ins = await supabase.from("quote_line_items").insert(payload);
    if (!ins.error) return;

    const err = ins.error;
    if (!isUnknownColumnSchemaError(err)) throw err;

    const msg = getErrorMessage(err, "");
    let stripped = false;

    if (msg.includes("'notes'") && payload[0] && "notes" in payload[0]) {
      payload = stripNotes(payload);
      stripped = true;
    }
    if (msg.includes("'partner_unit_cost'") && payload[0] && "partner_unit_cost" in payload[0]) {
      payload = stripPartnerUnitCost(payload);
      stripped = true;
    }

    if (!stripped) throw err;
  }

  throw new Error("Could not insert quote line items: exhausted schema fallbacks");
}
