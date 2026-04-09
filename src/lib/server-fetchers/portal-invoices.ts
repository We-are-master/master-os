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

/**
 * Returns invoices for an account split into outstanding and paid groups.
 * Invoices link directly to accounts via invoices.source_account_id, so
 * no client join is needed.
 */
export async function fetchAccountInvoices(accountId: string): Promise<{
  outstanding: PortalInvoiceRow[];
  paid:        PortalInvoiceRow[];
}> {
  const supabase = await getServerSupabase();

  const [outstandingRes, paidRes] = await Promise.all([
    supabase
      .from("invoices")
      .select(`
        id, reference, client_name, job_reference, amount, amount_paid,
        status, due_date, paid_date, invoice_kind, stripe_payment_link_url,
        created_at
      `)
      .eq("source_account_id", accountId)
      .is("deleted_at", null)
      .in("status", OUTSTANDING_STATUSES)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(200),

    supabase
      .from("invoices")
      .select(`
        id, reference, client_name, job_reference, amount, amount_paid,
        status, due_date, paid_date, invoice_kind, stripe_payment_link_url,
        created_at
      `)
      .eq("source_account_id", accountId)
      .is("deleted_at", null)
      .in("status", PAID_STATUSES)
      .order("paid_date", { ascending: false, nullsFirst: false })
      .limit(200),
  ]);

  return {
    outstanding: ((outstandingRes.data ?? []) as PortalInvoiceRow[]),
    paid:        ((paidRes.data ?? []) as PortalInvoiceRow[]),
  };
}
