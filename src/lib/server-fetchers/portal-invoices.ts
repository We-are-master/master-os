import { getServerSupabase } from "@/lib/supabase/server-cached";

export interface PortalInvoiceRow {
  id:                      string;
  reference:               string;
  client_name:             string | null;
  job_reference:           string | null;
  amount:                  number;
  amount_paid:             number;
  status:                  string;
  due_date:                string | null;
  paid_date:               string | null;
  invoice_kind:            string | null;
  stripe_payment_link_url: string | null;
  created_at:              string;
}

const OUTSTANDING_STATUSES = ["pending", "partially_paid", "overdue"];
const PAID_STATUSES        = ["paid"];
const INVOICE_COLUMNS = `
  id, reference, client_name, job_reference, amount, amount_paid,
  status, due_date, paid_date, invoice_kind, stripe_payment_link_url,
  created_at
`;

/**
 * Returns invoices for an account split into outstanding and paid groups.
 *
 * Invoices can link to an account in TWO ways:
 *  1. Directly via `invoices.source_account_id` (set when an invoice is
 *     created from the dashboard's create-invoice modal)
 *  2. Indirectly via `invoices.job_reference` → `jobs.reference` →
 *     `jobs.client_id` → `clients.source_account_id` (used by invoices
 *     auto-created from quote acceptance, which don't set source_account_id)
 *
 * The fetcher unions both sources so the portal shows ALL invoices that
 * belong to the account, regardless of which path was used to create them.
 */
export async function fetchAccountInvoices(accountId: string): Promise<{
  outstanding: PortalInvoiceRow[];
  paid:        PortalInvoiceRow[];
}> {
  const supabase = await getServerSupabase();

  // Resolve the set of job references that belong to clients of this account.
  // We need them for the fallback path (invoices linked via job_reference).
  const { data: clientRows } = await supabase
    .from("clients")
    .select("id")
    .eq("source_account_id", accountId)
    .is("deleted_at", null)
    .limit(1000);
  const clientIds = ((clientRows ?? []) as Array<{ id: string }>).map((c) => c.id);

  let jobReferences: string[] = [];
  if (clientIds.length > 0) {
    const { data: jobRows } = await supabase
      .from("jobs")
      .select("reference")
      .in("client_id", clientIds)
      .is("deleted_at", null)
      .not("reference", "is", null)
      .limit(2000);
    jobReferences = ((jobRows ?? []) as Array<{ reference: string }>)
      .map((j) => j.reference)
      .filter((r): r is string => typeof r === "string" && r.length > 0);
  }

  // Run two queries per status bucket: direct (source_account_id) + via
  // job_reference. Then de-dupe by id.
  const [
    outstandingDirectRes,
    outstandingByJobRes,
    paidDirectRes,
    paidByJobRes,
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select(INVOICE_COLUMNS)
      .eq("source_account_id", accountId)
      .is("deleted_at", null)
      .in("status", OUTSTANDING_STATUSES)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(200),

    jobReferences.length > 0
      ? supabase
          .from("invoices")
          .select(INVOICE_COLUMNS)
          .in("job_reference", jobReferences)
          .is("deleted_at", null)
          .in("status", OUTSTANDING_STATUSES)
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(200)
      : Promise.resolve({ data: [] as PortalInvoiceRow[] }),

    supabase
      .from("invoices")
      .select(INVOICE_COLUMNS)
      .eq("source_account_id", accountId)
      .is("deleted_at", null)
      .in("status", PAID_STATUSES)
      .order("paid_date", { ascending: false, nullsFirst: false })
      .limit(200),

    jobReferences.length > 0
      ? supabase
          .from("invoices")
          .select(INVOICE_COLUMNS)
          .in("job_reference", jobReferences)
          .is("deleted_at", null)
          .in("status", PAID_STATUSES)
          .order("paid_date", { ascending: false, nullsFirst: false })
          .limit(200)
      : Promise.resolve({ data: [] as PortalInvoiceRow[] }),
  ]);

  const outstanding = mergeInvoicesById(
    (outstandingDirectRes.data ?? []) as PortalInvoiceRow[],
    (outstandingByJobRes.data  ?? []) as PortalInvoiceRow[],
  );
  const paid = mergeInvoicesById(
    (paidDirectRes.data ?? []) as PortalInvoiceRow[],
    (paidByJobRes.data  ?? []) as PortalInvoiceRow[],
  );

  return { outstanding, paid };
}

function mergeInvoicesById(...lists: PortalInvoiceRow[][]): PortalInvoiceRow[] {
  const seen = new Map<string, PortalInvoiceRow>();
  for (const list of lists) {
    for (const inv of list) {
      if (inv?.id && !seen.has(inv.id)) seen.set(inv.id, inv);
    }
  }
  return Array.from(seen.values());
}
