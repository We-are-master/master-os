import { getSupabase } from "./base";
import { getClient } from "./clients";
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
  /** Single round-trip via PostgREST embed: clients → accounts (FK clients_source_account_id_fkey, see migration 031). */
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("clients")
    .select("source_account_id, source_account:accounts!clients_source_account_id_fkey(payment_terms)")
    .eq("id", clientId)
    .maybeSingle();
  if (!error && data) {
    const acct = (data as { source_account?: { payment_terms?: string | null } | { payment_terms?: string | null }[] | null }).source_account;
    const terms = Array.isArray(acct) ? acct[0]?.payment_terms : acct?.payment_terms;
    return terms?.trim() || null;
  }
  /** Fallback to two-step lookup if the embed fails (e.g. older DB without the FK name). */
  const client = await getClient(clientId);
  if (!client?.source_account_id) return null;
  const { data: acctRow } = await supabase
    .from("accounts")
    .select("payment_terms")
    .eq("id", client.source_account_id)
    .maybeSingle();
  return (acctRow as { payment_terms?: string | null } | null)?.payment_terms?.trim() || null;
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
