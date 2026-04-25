import { getServerSupabase } from "@/lib/supabase/server-cached";

export interface PortalQuoteRow {
  id:               string;
  reference:        string;
  title:            string;
  status:           string;
  total_value:      number;
  deposit_required: number;
  client_name:      string;
  property_address: string | null;
  created_at:       string;
}

export interface PortalQuoteDetail extends PortalQuoteRow {
  scope:                string | null;
  email_custom_message: string | null;
  rejection_reason:     string | null;
  customer_accepted:    boolean;
  request_reference:    string | null;
  partner_name:         string | null;
  line_items: Array<{
    id:          string;
    description: string;
    quantity:    number;
    unit_price:  number;
    total:       number;
    sort_order:  number | null;
  }>;
  account_id: string;
}

const PORTAL_VISIBLE_QUOTE_STATUSES = [
  "awaiting_customer",
  "awaiting_payment",
  "rejected",
  "converted_to_job",
];

/**
 * Returns the most recent quotes for an account that are visible in the
 * portal. Drafts and in-survey quotes are hidden from the customer.
 */
export async function fetchAccountQuotes(accountId: string): Promise<PortalQuoteRow[]> {
  const supabase = await getServerSupabase();

  const { data: clientRows } = await supabase
    .from("clients")
    .select("id")
    .eq("source_account_id", accountId)
    .is("deleted_at", null)
    .limit(1000);
  const clientIds = ((clientRows ?? []) as Array<{ id: string }>).map((c) => c.id);
  if (clientIds.length === 0) return [];

  const { data, error } = await supabase
    .from("quotes")
    .select("id, reference, title, status, total_value, deposit_required, client_name, property_address, created_at")
    .in("client_id", clientIds)
    .is("deleted_at", null)
    .in("status", PORTAL_VISIBLE_QUOTE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !data) return [];
  return data as PortalQuoteRow[];
}

/**
 * Loads a single quote scoped to an account. Returns null if the quote
 * doesn't exist OR if it belongs to a different account (caller cannot
 * distinguish — looks the same as 404 to defeat enumeration).
 */
export async function fetchPortalQuoteDetail(
  quoteId: string,
  accountId: string,
): Promise<PortalQuoteDetail | null> {
  const supabase = await getServerSupabase();

  const { data: quote } = await supabase
    .from("quotes")
    .select(`
      id, reference, title, status, total_value, deposit_required,
      client_name, client_id, property_address, scope, email_custom_message,
      rejection_reason, customer_accepted, partner_name, request_id,
      created_at
    `)
    .eq("id", quoteId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!quote) return null;
  const q = quote as Record<string, unknown>;

  // Verify ownership: the quote's client must belong to this account
  const clientId = q.client_id as string | null;
  if (!clientId) return null;
  const { data: client } = await supabase
    .from("clients")
    .select("source_account_id")
    .eq("id", clientId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!client || (client as { source_account_id?: string }).source_account_id !== accountId) {
    return null;
  }

  // Pull line items + linked request reference in parallel
  const [{ data: lineItems }, { data: req }] = await Promise.all([
    supabase
      .from("quote_line_items")
      .select("id, description, quantity, unit_price, total, sort_order")
      .eq("quote_id", quoteId)
      .order("sort_order", { ascending: true })
      .limit(200),
    q.request_id
      ? supabase
          .from("service_requests")
          .select("reference")
          .eq("id", q.request_id as string)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    id:                  q.id as string,
    reference:           (q.reference as string) ?? "",
    title:               (q.title as string) ?? "Quote",
    status:              (q.status as string) ?? "draft",
    total_value:         Number(q.total_value ?? 0),
    deposit_required:    Number(q.deposit_required ?? 0),
    client_name:         (q.client_name as string) ?? "",
    property_address:    (q.property_address as string | null) ?? null,
    scope:               (q.scope as string | null) ?? null,
    email_custom_message: (q.email_custom_message as string | null) ?? null,
    rejection_reason:    (q.rejection_reason as string | null) ?? null,
    customer_accepted:   Boolean(q.customer_accepted),
    request_reference:   ((req as { reference?: string } | null)?.reference) ?? null,
    partner_name:        (q.partner_name as string | null) ?? null,
    created_at:          (q.created_at as string) ?? "",
    line_items:          (lineItems ?? []) as PortalQuoteDetail["line_items"],
    account_id:          accountId,
  };
}
