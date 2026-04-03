import { getSupabase } from "./base";
import { getClient } from "./clients";
import { getAccount } from "./accounts";
import { dueDateIsoFromPaymentTerms } from "@/lib/invoice-payment-terms";

/**
 * Resolves `accounts.payment_terms` for a client linked to `source_account_id`, then returns due date YYYY-MM-DD.
 * If the client has no account or terms are missing, uses default Net 30 from `dueDateIsoFromPaymentTerms`.
 */
export async function getInvoiceDueDateIsoForClient(
  clientId: string | null | undefined,
  baseDate: Date = new Date(),
): Promise<string> {
  const terms = await getPaymentTermsForClient(clientId);
  return dueDateIsoFromPaymentTerms(baseDate, terms);
}

export async function getPaymentTermsForClient(clientId: string | null | undefined): Promise<string | null> {
  if (!clientId?.trim()) return null;
  const client = await getClient(clientId);
  if (!client?.source_account_id) return null;
  const account = await getAccount(client.source_account_id);
  return account?.payment_terms?.trim() || null;
}

export async function getSourceAccountIdForClient(clientId: string | null | undefined): Promise<string | null> {
  if (!clientId?.trim()) return null;
  const client = await getClient(clientId);
  return client?.source_account_id?.trim() ?? null;
}

/** Looks up job by reference, then applies the same client → account payment terms. */
export async function getInvoiceDueDateIsoForJobReference(
  jobReference: string | null | undefined,
  baseDate: Date = new Date(),
): Promise<string | null> {
  if (!jobReference?.trim()) return null;
  const supabase = getSupabase();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("client_id")
    .eq("reference", jobReference.trim())
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !job) return null;
  const clientId = (job as { client_id?: string | null }).client_id;
  return getInvoiceDueDateIsoForClient(clientId, baseDate);
}
