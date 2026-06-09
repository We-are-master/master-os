import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/finance/payment-runs
 *
 * Returns the Payment History feed for the billing widget:
 *  • Every `self_bill_payment_runs` row (one per Zendesk master ticket).
 *  • Each run with the joined self-bills (id, ref, partner, amount, status,
 *    email_sent_at, paid_at, wise_*).
 *  • Optional audit-log timeline (last 50 self-bill events) for the timeline
 *    panel.
 *
 * Ordered by `expected_pay_date desc` then `created_at desc`. Capped at 50
 * runs so the page renders fast; older runs are paginated via `?before=…`.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const admin = createServiceClient();
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
  const before = url.searchParams.get("before");

  let runQuery = admin
    .from("self_bill_payment_runs")
    .select(
      "id, cycle_kind, period_start, period_end, expected_pay_date, zendesk_ticket_id, zendesk_ticket_url, total_amount, self_bill_ids, created_at, created_by",
    )
    .order("expected_pay_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (before) runQuery = runQuery.lt("created_at", before);

  const { data: runs, error: runErr } = await runQuery;
  if (runErr) {
    return NextResponse.json({ error: runErr.message }, { status: 500 });
  }

  const runRows = (runs ?? []) as Array<{
    id: string;
    cycle_kind: "standard" | "off_cycle";
    period_start: string;
    period_end: string;
    expected_pay_date: string | null;
    zendesk_ticket_id: string | null;
    zendesk_ticket_url: string | null;
    total_amount: number;
    self_bill_ids: string[];
    created_at: string;
    created_by: string | null;
  }>;

  const allSelfBillIds = Array.from(new Set(runRows.flatMap((r) => r.self_bill_ids ?? [])));
  let selfBillsById: Record<string, {
    id: string;
    reference: string;
    partner_id: string | null;
    partner_name: string;
    net_payout: number;
    status: string;
    email_sent_at: string | null;
    paid_at: string | null;
    payment_run_id: string | null;
    zendesk_side_conversation_id: string | null;
  }> = {};

  if (allSelfBillIds.length > 0) {
    const { data: sbRows } = await admin
      .from("self_bills")
      .select("id, reference, partner_id, partner_name, net_payout, status, email_sent_at, paid_at, payment_run_id, zendesk_side_conversation_id")
      .in("id", allSelfBillIds);
    for (const r of (sbRows ?? []) as Array<typeof selfBillsById[string]>) {
      selfBillsById[r.id] = r;
    }
  }

  // Timeline — last 50 self-bill audit events. Used for the right-side log panel.
  const { data: auditRows } = await admin
    .from("audit_logs")
    .select("id, entity_id, entity_ref, action, field_name, new_value, user_name, metadata, created_at")
    .eq("entity_type", "self_bill")
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({
    runs: runRows.map((r) => ({
      ...r,
      self_bills: (r.self_bill_ids ?? []).map((id) => selfBillsById[id]).filter(Boolean),
    })),
    timeline: auditRows ?? [],
  });
}
