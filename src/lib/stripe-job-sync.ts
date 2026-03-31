import type { SupabaseClient } from "@supabase/supabase-js";
import { syncJobAfterInvoicePaidToLedger } from "@/lib/sync-job-after-invoice-paid";

/**
 * After a Stripe webhook marks an invoice paid, align job ledger + optionally complete.
 */
export async function syncJobAfterStripeInvoicePaid(
  admin: SupabaseClient,
  invoiceId: string
): Promise<void> {
  await syncJobAfterInvoicePaidToLedger(admin, invoiceId, "Stripe");
}
