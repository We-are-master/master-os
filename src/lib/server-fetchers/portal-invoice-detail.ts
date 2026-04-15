/**
 * Detail fetcher for a single invoice in the portal. Verifies account
 * ownership (defense-in-depth on top of RLS from migration 142), and
 * returns the fields the portal UI needs to render a complete invoice
 * page: header, line items, payment ledger, linked job summary.
 *
 * Never returns: internal_notes, supplier cost columns, or any partner-
 * side ledger entries.
 */

import { getServerSupabase } from "@/lib/supabase/server-cached";

export interface PortalInvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  sort_order: number;
}

export interface PortalInvoicePayment {
  id: string;
  amount: number;
  paid_at: string | null;
  type: string;
  method: string | null;
}

export interface PortalInvoiceDetail {
  id: string;
  reference: string;
  status: string;
  invoice_kind: string | null;
  client_name: string | null;
  job_reference: string | null;
  job_id: string | null;
  job_title: string | null;
  amount: number;
  amount_paid: number;
  balance: number;
  due_date: string | null;
  paid_date: string | null;
  stripe_payment_link_url: string | null;
  issued_at: string | null;
  billing_address: string | null;
  line_items: PortalInvoiceLineItem[];
  payments: PortalInvoicePayment[];
  created_at: string;
}

function asNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchPortalInvoiceDetail(
  invoiceId: string,
  accountId: string,
): Promise<PortalInvoiceDetail | null> {
  const supabase = await getServerSupabase();

  const { data: inv } = await supabase
    .from("invoices")
    .select(`
      id, reference, status, invoice_kind, client_name, job_reference,
      amount, amount_paid, balance, due_date, paid_date, stripe_payment_link_url,
      issued_at, billing_address, created_at, source_account_id
    `)
    .eq("id", invoiceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!inv) return null;

  const invRow = inv as Record<string, unknown>;
  const directAccount = invRow.source_account_id as string | null;

  // Defense-in-depth: either direct link OR job→client→account chain
  let isOwned = directAccount === accountId;
  let jobId: string | null = null;
  let jobTitle: string | null = null;
  const jobReference = (invRow.job_reference as string | null) ?? null;

  if (jobReference) {
    const { data: job } = await supabase
      .from("jobs")
      .select("id, title, client_id")
      .eq("reference", jobReference)
      .is("deleted_at", null)
      .maybeSingle();
    if (job) {
      const jobRow = job as { id: string; title: string; client_id: string | null };
      jobId = jobRow.id;
      jobTitle = jobRow.title;
      if (jobRow.client_id) {
        const { data: client } = await supabase
          .from("clients")
          .select("source_account_id")
          .eq("id", jobRow.client_id)
          .maybeSingle();
        if (client && (client as { source_account_id?: string }).source_account_id === accountId) {
          isOwned = true;
        }
      }
    }
  }

  if (!isOwned) return null;

  // Load line items (quote_line_items linked via the source quote if any).
  // Invoice lines live on `invoice_line_items` when created standalone; fall
  // back to the source quote's lines when the invoice was auto-generated.
  let lineItems: PortalInvoiceLineItem[] = [];
  const { data: invoiceLines } = await supabase
    .from("invoice_line_items")
    .select("id, description, quantity, unit_price, total, sort_order")
    .eq("invoice_id", invoiceId)
    .order("sort_order", { ascending: true });
  if (invoiceLines && invoiceLines.length > 0) {
    lineItems = (invoiceLines as Array<Record<string, unknown>>).map((l) => ({
      id: l.id as string,
      description: (l.description as string) ?? "",
      quantity: asNum(l.quantity),
      unit_price: asNum(l.unit_price),
      total: asNum(l.total),
      sort_order: asNum(l.sort_order),
    }));
  } else if (jobId) {
    // Fallback to quote lines if the invoice was generated from a quote
    const { data: quote } = await supabase
      .from("quotes")
      .select("id")
      .eq("job_reference", jobReference)
      .maybeSingle();
    if (quote) {
      const { data: quoteLines } = await supabase
        .from("quote_line_items")
        .select("id, description, quantity, unit_price, sort_order")
        .eq("quote_id", (quote as { id: string }).id)
        .order("sort_order", { ascending: true });
      if (quoteLines) {
        lineItems = (quoteLines as Array<Record<string, unknown>>).map((l) => {
          const q = asNum(l.quantity);
          const u = asNum(l.unit_price);
          return {
            id: l.id as string,
            description: (l.description as string) ?? "",
            quantity: q,
            unit_price: u,
            total: q * u,
            sort_order: asNum(l.sort_order),
          };
        });
      }
    }
  }

  // Customer-side payments attached to the linked job (RLS already hides
  // partner_* rows from portal, but we filter again for clarity).
  let payments: PortalInvoicePayment[] = [];
  if (jobId) {
    const { data: payRows } = await supabase
      .from("job_payments")
      .select("id, amount, payment_date, type, payment_method")
      .eq("job_id", jobId)
      .in("type", ["customer_deposit", "customer_final"])
      .is("deleted_at", null)
      .order("payment_date", { ascending: true });
    if (payRows) {
      payments = (payRows as Array<Record<string, unknown>>).map((p) => ({
        id: p.id as string,
        amount: asNum(p.amount),
        paid_at: (p.payment_date as string | null) ?? null,
        type: (p.type as string) ?? "",
        method: (p.payment_method as string | null) ?? null,
      }));
    }
  }

  return {
    id: invRow.id as string,
    reference: (invRow.reference as string) ?? "",
    status: (invRow.status as string) ?? "pending",
    invoice_kind: (invRow.invoice_kind as string | null) ?? null,
    client_name: (invRow.client_name as string | null) ?? null,
    job_reference: jobReference,
    job_id: jobId,
    job_title: jobTitle,
    amount: asNum(invRow.amount),
    amount_paid: asNum(invRow.amount_paid),
    balance: asNum(invRow.balance),
    due_date: (invRow.due_date as string | null) ?? null,
    paid_date: (invRow.paid_date as string | null) ?? null,
    stripe_payment_link_url: (invRow.stripe_payment_link_url as string | null) ?? null,
    issued_at: (invRow.issued_at as string | null) ?? null,
    billing_address: (invRow.billing_address as string | null) ?? null,
    line_items: lineItems,
    payments,
    created_at: (invRow.created_at as string) ?? "",
  };
}
