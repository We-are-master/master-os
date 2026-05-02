import type { SupabaseClient } from "@supabase/supabase-js";

export type OpsSnapshot = {
  generatedAt: string;
  jobsTotal: number;
  jobsNotCompleted: number;
  jobsScheduledToday: number;
  quotesAwaitingCustomer: number;
  requestsNew: number;
  invoicesPending: number;
  invoicesPendingAmount: number;
  recentLines: string[];
};

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Aggregate operational metrics for daily brief / Fixfy Brain context (service role client).
 */
export async function fetchOpsSnapshot(admin: SupabaseClient): Promise<OpsSnapshot> {
  const todayUtc = ymdUtc(new Date());

  const [
    jobsTotal,
    jobsNotCompleted,
    jobsToday,
    quotesAwaiting,
    requestsNew,
    invPendingRows,
    audits,
  ] = await Promise.all([
    admin.from("jobs").select("id", { count: "exact", head: true }).is("deleted_at", null),
    admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .neq("status", "completed"),
    admin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .eq("scheduled_date", todayUtc),
    admin.from("quotes").select("id", { count: "exact", head: true }).eq("status", "awaiting_customer"),
    admin.from("service_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
    admin.from("invoices").select("amount").eq("status", "pending").is("deleted_at", null).limit(2000),
    admin.from("audit_logs").select("entity_type, action, entity_ref, new_value, created_at").order("created_at", { ascending: false }).limit(6),
  ]);

  const invRows = (invPendingRows.data ?? []) as { amount?: number }[];
  const pendingAmount = invRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const recent = (audits.data ?? []) as {
    entity_type: string;
    action: string;
    entity_ref?: string;
    new_value?: string;
    created_at: string;
  }[];

  const recentLines = recent.map((r) => {
    const ref = r.entity_ref ? ` ${r.entity_ref}` : "";
    return `${r.entity_type}${ref}: ${r.action}${r.new_value ? ` → ${r.new_value}` : ""}`;
  });

  return {
    generatedAt: new Date().toISOString(),
    jobsTotal: jobsTotal.count ?? 0,
    jobsNotCompleted: jobsNotCompleted.count ?? 0,
    jobsScheduledToday: jobsToday.count ?? 0,
    quotesAwaitingCustomer: quotesAwaiting.count ?? 0,
    requestsNew: requestsNew.count ?? 0,
    invoicesPending: invRows.length,
    invoicesPendingAmount: pendingAmount,
    recentLines,
  };
}

export function snapshotToPromptBlock(s: OpsSnapshot): string {
  return [
    `Snapshot generated at (UTC): ${s.generatedAt}`,
    `Jobs (non-deleted): ${s.jobsTotal} total, ${s.jobsNotCompleted} not completed, ${s.jobsScheduledToday} linked to today (date/start).`,
    `Quotes awaiting customer: ${s.quotesAwaitingCustomer}.`,
    `New service requests: ${s.requestsNew}.`,
    `Pending invoices: ${s.invoicesPending} (≈ £${s.invoicesPendingAmount.toFixed(2)} outstanding).`,
    s.recentLines.length ? `Recent audit highlights:\n- ${s.recentLines.join("\n- ")}` : "No recent audit lines.",
  ].join("\n");
}

/** Quote pipeline detail for Manager / Operator Fixfy Brain. */
export async function fetchQuotesPipelineBlock(admin: SupabaseClient): Promise<string> {
  const statuses = ["draft", "in_survey", "bidding", "awaiting_customer", "awaiting_payment"] as const;
  const countResults = await Promise.all(
    statuses.map((st) => admin.from("quotes").select("id", { count: "exact", head: true }).eq("status", st)),
  );
  const countLine = statuses.map((st, i) => `${st}: ${countResults[i].count ?? 0}`).join(" | ");

  const { data: hot } = await admin
    .from("quotes")
    .select("reference, title, client_name, total_value, status, margin_percent")
    .in("status", ["awaiting_customer", "bidding", "in_survey", "draft"])
    .order("updated_at", { ascending: false })
    .limit(12);

  const rows = (hot ?? []) as {
    reference: string;
    title: string;
    client_name: string;
    total_value: number;
    status: string;
    margin_percent?: number;
  }[];
  const detail =
    rows.length > 0
      ? rows
          .map(
            (q) =>
              `- ${q.reference} | ${q.status} | ${q.client_name ?? ""} | £${Number(q.total_value).toFixed(2)} | margin ${q.margin_percent != null ? `${q.margin_percent}%` : "n/a"}`,
          )
          .join("\n")
      : "(no quotes in these statuses)";

  return [`Quote pipeline counts: ${countLine}.`, "Sample quotes (newest first):", detail].join("\n");
}

/** Jobs owned by the user (typical operator / coordinator view). */
export async function fetchAssignedJobsBlock(admin: SupabaseClient, profileId: string): Promise<string> {
  const { data } = await admin
    .from("jobs")
    .select("reference, title, status, scheduled_date, client_name, current_phase, total_phases, property_address")
    .eq("owner_id", profileId)
    .is("deleted_at", null)
    .neq("status", "completed")
    .order("scheduled_date", { ascending: true })
    .limit(18);

  const jobs = (data ?? []) as {
    reference: string;
    title: string;
    status: string;
    scheduled_date?: string;
    client_name: string;
    current_phase: number;
    total_phases: number;
    property_address?: string;
  }[];

  if (!jobs.length) {
    return "Open jobs assigned to this user (owner_id): none. They may still work on jobs without being set as owner in the system.";
  }

  return [
    "Open jobs where this user is job owner:",
    ...jobs.map(
      (j) =>
        `- ${j.reference} | ${j.title} | ${j.status} | phase ${j.current_phase}/${j.total_phases} | date ${j.scheduled_date ?? "—"} | ${j.client_name} @ ${j.property_address ?? ""}`,
    ),
  ].join("\n");
}
