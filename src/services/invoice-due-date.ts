import { getSupabase } from "./base";
import { getClient } from "./clients";
import { getCompanySettings } from "./company";
import {
  dueDateIsoFromAccountPaymentTerms,
  orgCtxFromSetup,
  type AccountPaymentOrgContext,
} from "@/lib/account-payment-due-date";
import { dueDateIsoForJobAccountTerms } from "@/lib/job-invoice-due-anchor";
import { resolveJobCompletionInstant, type JobCompletionAnchorInput } from "@/lib/job-completion-anchor";
import { parseFrontendSetup } from "@/lib/frontend-setup";
import type { JobKind } from "@/types/database";

export type InvoiceDueDateOptions = {
  jobKind?: JobKind | null;
  /** The job itself: due date counts from its completion (falls back to its schedule). */
  scheduleJob?: JobCompletionAnchorInput | null;
};

let cachedOrgCtx: AccountPaymentOrgContext | undefined;

async function loadAccountPaymentOrgContext(): Promise<AccountPaymentOrgContext> {
  if (cachedOrgCtx) return cachedOrgCtx;
  try {
    const row = await getCompanySettings();
    cachedOrgCtx = orgCtxFromSetup(parseFrontendSetup(row?.frontend_setup));
  } catch {
    cachedOrgCtx = orgCtxFromSetup(null);
  }
  return cachedOrgCtx;
}

/**
 * Resolves `accounts.payment_terms` for a client linked to `source_account_id`, then returns due date YYYY-MM-DD.
 * Biweekly accounts on the org standard grid use the same reference Friday as partner self-bills (Setup).
 * One-off Due on Receipt: use `scheduleJob` so due = scheduled finish + 72h.
 */
export async function getInvoiceDueDateIsoForClient(
  clientId: string | null | undefined,
  baseDate: Date = new Date(),
  orgCtx?: AccountPaymentOrgContext | null,
  options?: InvoiceDueDateOptions,
): Promise<string> {
  const terms = await getPaymentTermsForClient(clientId);
  const ctx = orgCtx ?? (await loadAccountPaymentOrgContext());
  // O vencimento conta do dia em que o job foi concluído (dono, 09/10/2026); antes de
  // concluir, a agenda é a melhor estimativa e é recalculado quando o job fecha.
  const completion = options?.scheduleJob ? resolveJobCompletionInstant(options.scheduleJob) : null;
  const base = completion ?? baseDate;
  return dueDateIsoForJobAccountTerms(base, terms, ctx, {
    jobKind: options?.jobKind ?? options?.scheduleJob?.job_kind,
    scheduleAnchor: completion,
  });
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
    .select("client_id, job_kind, scheduled_date, scheduled_start_at, completed_date, partner_timer_ended_at, final_report")
    .eq("reference", jobReference.trim())
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !job) return null;
  const row = job as JobCompletionAnchorInput & { client_id?: string | null };
  return getInvoiceDueDateIsoForClient(row.client_id, baseDate, undefined, {
    jobKind: row.job_kind,
    scheduleJob: row,
  });
}
