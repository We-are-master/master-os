import { getServerSupabase } from "@/lib/supabase/server-cached";
import { fetchAccountInvoices } from "./portal-invoices";

export interface PortalDashboardKpis {
  openRequests:        number;
  pendingQuotes:       number;
  jobsInProgress:      number;
  outstandingInvoices: { count: number; total: number };
  recentActivity: Array<{
    id:         string;
    type:       "request" | "quote" | "job" | "invoice";
    title:      string;
    reference:  string;
    status:     string;
    created_at: string;
  }>;
}

/**
 * Fetches dashboard KPIs scoped to a single account.
 *
 * Scoping rules:
 * - service_requests / quotes / jobs all link via clients.source_account_id
 * - invoices link via invoices.source_account_id (direct)
 *
 * Each query is bounded — never returns more than 5 rows for the activity
 * feed and uses HEAD count queries for the KPI tiles (zero rows transferred).
 */
export async function fetchPortalDashboardKpis(accountId: string): Promise<PortalDashboardKpis> {
  const supabase = await getServerSupabase();

  // Resolve the client ids for this account up front. Most queries below
  // need them. Bounded — an account is unlikely to have thousands of
  // distinct client rows; cap at 1000 to be safe.
  const { data: clientRows } = await supabase
    .from("clients")
    .select("id")
    .eq("source_account_id", accountId)
    .is("deleted_at", null)
    .limit(1000);

  const clientIds = ((clientRows ?? []) as Array<{ id: string }>).map((c) => c.id);

  // Always fetch invoices via the dedicated portal-invoices fetcher so the
  // dashboard tile uses the SAME source-of-truth as /portal/invoices —
  // covering both source_account_id linkage AND job_reference fallback.
  const invoicesPromise = fetchAccountInvoices(accountId);

  // If the account has no client rows yet, every client-scoped query below
  // would return empty — short-circuit instead of firing them.
  if (clientIds.length === 0) {
    const invoices = await invoicesPromise;
    const outstandingTotalEarly = invoices.outstanding.reduce(
      (s, i) => s + Number(i.amount ?? 0),
      0,
    );
    return {
      openRequests:        0,
      pendingQuotes:       0,
      jobsInProgress:      0,
      outstandingInvoices: { count: invoices.outstanding.length, total: outstandingTotalEarly },
      recentActivity:      [],
    };
  }

  const [
    openReqRes,
    pendingQuotesRes,
    jobsInProgRes,
    invoices,
    recentReqRes,
    recentQuoteRes,
    recentJobRes,
  ] = await Promise.all([
    supabase
      .from("service_requests")
      .select("id", { count: "exact", head: true })
      .in("client_id", clientIds)
      .is("deleted_at", null)
      .in("status", ["new", "in_review", "qualified"]),

    supabase
      .from("quotes")
      .select("id", { count: "exact", head: true })
      .in("client_id", clientIds)
      .is("deleted_at", null)
      .eq("status", "awaiting_customer"),

    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .in("client_id", clientIds)
      .is("deleted_at", null)
      .in("status", [
        "scheduled",
        "in_progress_phase1",
        "in_progress_phase2",
        "in_progress_phase3",
        "final_check",
        "awaiting_payment",
      ]),

    invoicesPromise,

    supabase
      .from("service_requests")
      .select("id, reference, service_type, status, created_at")
      .in("client_id", clientIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(3),

    supabase
      .from("quotes")
      .select("id, reference, title, status, created_at")
      .in("client_id", clientIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(3),

    supabase
      .from("jobs")
      .select("id, reference, title, status, created_at")
      .in("client_id", clientIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  const outstandingTotal = invoices.outstanding.reduce(
    (s, i) => s + Number(i.amount ?? 0),
    0,
  );
  const outstandingCount = invoices.outstanding.length;

  const recentActivity: PortalDashboardKpis["recentActivity"] = [];

  for (const r of (recentReqRes.data ?? []) as Array<{
    id: string; reference: string; service_type: string; status: string; created_at: string;
  }>) {
    recentActivity.push({
      id:         r.id,
      type:       "request",
      title:      r.service_type ?? "Service request",
      reference:  r.reference,
      status:     r.status,
      created_at: r.created_at,
    });
  }
  for (const q of (recentQuoteRes.data ?? []) as Array<{
    id: string; reference: string; title: string; status: string; created_at: string;
  }>) {
    recentActivity.push({
      id:         q.id,
      type:       "quote",
      title:      q.title ?? "Quote",
      reference:  q.reference,
      status:     q.status,
      created_at: q.created_at,
    });
  }
  for (const j of (recentJobRes.data ?? []) as Array<{
    id: string; reference: string; title: string; status: string; created_at: string;
  }>) {
    recentActivity.push({
      id:         j.id,
      type:       "job",
      title:      j.title ?? "Job",
      reference:  j.reference,
      status:     j.status,
      created_at: j.created_at,
    });
  }

  // Sort by created_at desc and keep top 5
  recentActivity.sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
  );

  return {
    openRequests:        openReqRes.count ?? 0,
    pendingQuotes:       pendingQuotesRes.count ?? 0,
    jobsInProgress:      jobsInProgRes.count ?? 0,
    outstandingInvoices: { count: outstandingCount, total: outstandingTotal },
    recentActivity:      recentActivity.slice(0, 5),
  };
}
