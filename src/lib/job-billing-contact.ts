import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveNominalBillingParty } from "@/lib/account-billing-addressee";
import { quoteClientEmailFallback } from "@/lib/quote-client-email-fallback";

export type JobBillingContactSnapshot = {
  documentEmail: string | null;
  mode: "end_client" | "account";
  displayName: string;
  sourceAccountId: string | null;
};

export type JobBillingInput = {
  id?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  quote_id?: string | null;
  /** When set, used to find a linked job/quote if `quote_id` is missing on the job row. */
  invoice_id?: string | null;
};

type QuoteBillingMeta = {
  clientId: string | null;
  clientEmail: string | null;
};

async function loadQuoteBillingMeta(
  admin: SupabaseClient,
  quoteId: string,
): Promise<QuoteBillingMeta> {
  const { data: quote } = await admin
    .from("quotes")
    .select("client_id, client_email")
    .eq("id", quoteId)
    .is("deleted_at", null)
    .maybeSingle();
  const clientId = (quote as { client_id?: string | null } | null)?.client_id?.trim() || null;
  let clientEmail = (quote as { client_email?: string | null } | null)?.client_email?.trim() || null;
  if (!clientEmail) {
    clientEmail = (await quoteClientEmailFallback(admin, quoteId)) || null;
  }
  return { clientId, clientEmail };
}

/**
 * Resolve quote id for billing when the job row has no `quote_id` (e.g. Desk-created jobs).
 */
export async function resolveQuoteIdForJob(
  admin: SupabaseClient,
  job: Pick<JobBillingInput, "id" | "quote_id">,
  invoiceId?: string | null,
): Promise<string | null> {
  const fromJob = job.quote_id?.trim();
  if (fromJob) return fromJob;

  const jobId = job.id?.trim();
  if (jobId) {
    const { data } = await admin
      .from("jobs")
      .select("quote_id")
      .eq("id", jobId)
      .is("deleted_at", null)
      .maybeSingle();
    const qid = (data as { quote_id?: string | null } | null)?.quote_id?.trim();
    if (qid) return qid;
  }

  const invId = invoiceId?.trim();
  if (invId) {
    const { data } = await admin
      .from("jobs")
      .select("quote_id")
      .eq("invoice_id", invId)
      .is("deleted_at", null)
      .maybeSingle();
    const qid = (data as { quote_id?: string | null } | null)?.quote_id?.trim();
    if (qid) return qid;
  }

  return null;
}

function snapshotFromBilling(
  billing: Awaited<ReturnType<typeof resolveNominalBillingParty>>,
  quoteFallbackEmail: string | null,
  fallbackName: string,
): JobBillingContactSnapshot {
  const documentEmail = billing.documentEmail?.trim() || quoteFallbackEmail;
  return {
    documentEmail,
    mode: billing.mode,
    displayName: billing.displayName,
    sourceAccountId: billing.sourceAccountId,
  };
}

/**
 * Single resolver for job invoice sends — used by billing-contact API and send-email.
 * When `job.client_id` is missing, falls back to quote `client_id` / `client_email`.
 */
export async function resolveJobBillingContact(
  admin: SupabaseClient,
  job: JobBillingInput,
): Promise<JobBillingContactSnapshot> {
  const fallbackName = job.client_name?.trim() || "Client";
  const quoteId = await resolveQuoteIdForJob(admin, job, job.invoice_id);

  let quoteClientId: string | null = null;
  let quoteFallbackEmail: string | null = null;
  if (quoteId) {
    const meta = await loadQuoteBillingMeta(admin, quoteId);
    quoteClientId = meta.clientId;
    quoteFallbackEmail = meta.clientEmail;
  }

  const jobClientId = job.client_id?.trim() || "";
  const primaryClientId = jobClientId || quoteClientId || "";

  if (primaryClientId) {
    let billing = await resolveNominalBillingParty(admin, {
      clientId: primaryClientId,
      fallbackName,
      fallbackEmail: quoteFallbackEmail,
    });

    if (
      !billing.documentEmail?.trim() &&
      quoteClientId &&
      quoteClientId !== primaryClientId
    ) {
      billing = await resolveNominalBillingParty(admin, {
        clientId: quoteClientId,
        fallbackName,
        fallbackEmail: quoteFallbackEmail,
      });
    }

    return snapshotFromBilling(billing, quoteFallbackEmail, fallbackName);
  }

  return {
    displayName: fallbackName,
    documentEmail: quoteFallbackEmail,
    sourceAccountId: null,
    mode: "end_client",
  };
}

const JOB_FOR_INVOICE_SELECT =
  "id, reference, title, client_id, client_name, property_address, service_type, completed_date, quote_id, partner_agreed_value, partner_cost, materials_cost, internal_invoice_approved";

/** Resolve the job row for an invoice (reference → invoice_id link → explicit job id). */
export async function resolveJobForInvoiceSend(
  admin: SupabaseClient,
  invoice: { id: string; job_reference?: string | null },
  preferredJobId?: string | null,
) {
  const jobId = preferredJobId?.trim();
  if (jobId) {
    const { data } = await admin
      .from("jobs")
      .select(JOB_FOR_INVOICE_SELECT)
      .eq("id", jobId)
      .is("deleted_at", null)
      .maybeSingle();
    if (data) return data;
  }

  const ref = invoice.job_reference?.trim();
  if (ref) {
    const { data } = await admin
      .from("jobs")
      .select(JOB_FOR_INVOICE_SELECT)
      .eq("reference", ref)
      .is("deleted_at", null)
      .maybeSingle();
    if (data) return data;
  }

  const { data } = await admin
    .from("jobs")
    .select(JOB_FOR_INVOICE_SELECT)
    .eq("invoice_id", invoice.id)
    .is("deleted_at", null)
    .maybeSingle();
  return data ?? null;
}
