import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { dueDateIsoFromPaymentTerms } from "@/lib/invoice-payment-terms";

export const dynamic = "force-dynamic";

const ADMIN_ROLES = new Set(["admin", "manager"]);
const SKIP_STATUSES = new Set(["paid", "cancelled"]);
const CHUNK = 200;

/**
 * POST /api/admin/invoices/recalculate-due-dates
 * Body: { dryRun?: boolean }
 *
 * For each non-paid/cancelled invoice with a job_reference:
 *   1. invoice.source_account_id (direct, consolidated invoices)
 *   2. job.client_id → clients.source_account_id → accounts.payment_terms
 *
 * Anchor date: job.scheduled_date → job.scheduled_start_at → invoice.created_at
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!ADMIN_ROLES.has(role)) {
    return NextResponse.json({ error: "Admin or manager required" }, { status: 403 });
  }

  let dryRun = false;
  let scopeAccountId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    dryRun = body.dryRun === true;
    scopeAccountId = typeof body.accountId === "string" ? body.accountId : null;
  } catch { /* no body */ }

  const admin = createServiceClient();

  // ── 1. Eligible invoices ──────────────────────────────────────────────────
  let invoicesQuery = admin
    .from("invoices")
    .select("id, reference, job_reference, due_date, source_account_id, status, created_at")
    .not("job_reference", "is", null)
    .is("deleted_at", null);
  if (scopeAccountId) {
    invoicesQuery = invoicesQuery.eq("source_account_id", scopeAccountId);
  }
  const { data: rawInvoices, error: invErr } = await invoicesQuery;

  if (invErr) {
    console.error("[recalculate-due-dates] fetch invoices:", invErr);
    return NextResponse.json({ error: "Failed to fetch invoices" }, { status: 500 });
  }

  const invoices = (rawInvoices ?? []).filter(
    (i) => !SKIP_STATUSES.has(i.status as string),
  );
  if (invoices.length === 0) {
    return NextResponse.json({ updated: 0, noAccount: 0, sameDate: 0, changes: [], debug: { invoicesTotal: 0 } });
  }

  // ── 2. Jobs → client_id + scheduled dates (all invoices need the date for the anchor) ──
  const jobRefs = [...new Set(
    invoices.map((i) => (i.job_reference as string).trim()),
  )];

  type JobRow = {
    reference: string;
    client_id: string | null;
    completed_date: string | null;
    scheduled_finish_date: string | null;
    scheduled_end_at: string | null;
    scheduled_start_at: string | null;
  };
  const allJobs: JobRow[] = [];
  for (let i = 0; i < jobRefs.length; i += CHUNK) {
    const { data: chunk, error: jobErr } = await admin
      .from("jobs")
      .select("reference, client_id, completed_date, scheduled_finish_date, scheduled_end_at, scheduled_start_at")
      .in("reference", jobRefs.slice(i, i + CHUNK));
    if (jobErr) console.error("[recalculate-due-dates] jobs query error:", jobErr);
    if (chunk) allJobs.push(...(chunk as JobRow[]));
  }
  const jobByRef = Object.fromEntries(allJobs.map((j) => [j.reference, j]));
  const clientIdByJobRef = Object.fromEntries(
    allJobs.filter((j) => j.client_id).map((j) => [j.reference, j.client_id as string]),
  );

  // ── 3. Clients → source_account_id ────────────────────────────────────────
  const clientIds = [...new Set(Object.values(clientIdByJobRef))];
  type ClientRow = { id: string; source_account_id: string | null };
  const allClients: ClientRow[] = [];
  for (let i = 0; i < clientIds.length; i += CHUNK) {
    const { data: chunk } = await admin
      .from("clients")
      .select("id, source_account_id")
      .in("id", clientIds.slice(i, i + CHUNK));
    if (chunk) allClients.push(...(chunk as ClientRow[]));
  }
  const accountIdByClientId = Object.fromEntries(
    allClients.filter((c) => c.source_account_id).map((c) => [c.id, c.source_account_id as string]),
  );

  // ── 4. Accounts → payment_terms ───────────────────────────────────────────
  const rawAccountIds = [...new Set([
    ...invoices.map((i) => i.source_account_id as string | null | undefined),
    ...Object.values(accountIdByClientId),
  ].filter((id): id is string => !!id))];

  type AccountRow = { id: string; payment_terms: string | null };
  const allAccounts: AccountRow[] = [];
  for (let i = 0; i < rawAccountIds.length; i += CHUNK) {
    const { data: chunk } = await admin
      .from("accounts")
      .select("id, payment_terms")
      .in("id", rawAccountIds.slice(i, i + CHUNK));
    if (chunk) allAccounts.push(...(chunk as AccountRow[]));
  }
  const accountById = Object.fromEntries(allAccounts.map((a) => [a.id, a]));

  // ── 5. Compute new due dates ──────────────────────────────────────────────
  type Change = { id: string; reference: string; old_due_date: string; new_due_date: string };
  const changes: Change[] = [];
  let noAccount = 0;
  let sameDate = 0;

  for (const inv of invoices) {
    const jobRef = (inv.job_reference as string).trim();

    // Resolve account id
    const accountId =
      (inv.source_account_id as string | null) ||
      (clientIdByJobRef[jobRef] ? accountIdByClientId[clientIdByJobRef[jobRef]] : null);

    const account = accountId ? accountById[accountId] : undefined;
    if (!account?.payment_terms) { noAccount++; continue; }

    // Anchor = actual completion → planned finish → scheduled end → start → invoice created_at
    const job = jobByRef[jobRef];
    const anchorStr =
      job?.completed_date?.slice(0, 10) ??
      job?.scheduled_finish_date?.slice(0, 10) ??
      (job?.scheduled_end_at ? job.scheduled_end_at.slice(0, 10) : null) ??
      (job?.scheduled_start_at ? job.scheduled_start_at.slice(0, 10) : null) ??
      (inv.created_at as string | null) ??
      new Date().toISOString();
    const anchor = new Date(anchorStr + (anchorStr.length === 10 ? "T00:00:00" : ""));

    const newDueDate = dueDateIsoFromPaymentTerms(anchor, account.payment_terms);

    if (newDueDate !== inv.due_date) {
      changes.push({
        id: inv.id as string,
        reference: inv.reference as string,
        old_due_date: inv.due_date as string,
        new_due_date: newDueDate,
      });
    } else {
      sameDate++;
    }
  }

  const debug = {
    invoicesTotal: invoices.length,
    jobRefsSearched: jobRefs.length,
    jobsFound: allJobs.length,
    clientsFound: allClients.length,
    accountsFound: allAccounts.length,
    noAccount,
    sameDate,
    toUpdate: changes.length,
  };

  if (dryRun) {
    return NextResponse.json({ updated: 0, noAccount, sameDate, changes, dryRun: true, debug });
  }

  // ── 6. Batch update ───────────────────────────────────────────────────────
  const UPDATE_CHUNK = 50;
  let updatedCount = 0;
  for (let i = 0; i < changes.length; i += UPDATE_CHUNK) {
    await Promise.all(
      changes.slice(i, i + UPDATE_CHUNK).map((c) =>
        admin.from("invoices").update({ due_date: c.new_due_date }).eq("id", c.id),
      ),
    );
    updatedCount += UPDATE_CHUNK;
  }

  return NextResponse.json({ updated: updatedCount, noAccount, sameDate, changes, debug });
}
