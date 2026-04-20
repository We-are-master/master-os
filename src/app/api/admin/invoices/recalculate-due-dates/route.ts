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
 * Recalculates due_date for all non-paid/cancelled invoices using:
 *   job.scheduled_date + account.payment_terms → dueDateIsoFromPaymentTerms
 *
 * Account resolution order per invoice:
 *   1. invoice.source_account_id (consolidated weekly invoices)
 *   2. job.account_id (denormalised shortcut, often null on older jobs)
 *   3. job.client_id → clients.source_account_id (most reliable fallback)
 *
 * Returns { updated, skipped, noAccount, sameDate, changes[] }
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
  try {
    const body = await req.json().catch(() => ({}));
    dryRun = body.dryRun === true;
  } catch { /* no body */ }

  const admin = createServiceClient();

  // ── 1. Eligible invoices ──────────────────────────────────────────────────
  const { data: rawInvoices, error: invErr } = await admin
    .from("invoices")
    .select("id, reference, job_reference, due_date, source_account_id, status")
    .not("job_reference", "is", null)
    .is("deleted_at", null);

  if (invErr) {
    console.error("[recalculate-due-dates] fetch invoices:", invErr);
    return NextResponse.json({ error: "Failed to fetch invoices" }, { status: 500 });
  }

  const invoices = (rawInvoices ?? []).filter(
    (i) => !SKIP_STATUSES.has(i.status as string),
  );
  if (invoices.length === 0) {
    return NextResponse.json({ updated: 0, skipped: 0, noAccount: 0, sameDate: 0, changes: [] });
  }

  // ── 2. Jobs (reference + scheduled_date + account_id + client_id) ─────────
  const jobRefs = [...new Set(invoices.map((i) => i.job_reference as string))];
  type JobRow = { reference: string; scheduled_date: string | null; created_at: string | null; account_id: string | null; client_id: string | null };
  const allJobs: JobRow[] = [];
  for (let i = 0; i < jobRefs.length; i += CHUNK) {
    const { data: chunk } = await admin
      .from("jobs")
      .select("reference, scheduled_date, created_at, account_id, client_id")
      .in("reference", jobRefs.slice(i, i + CHUNK));
    if (chunk) allJobs.push(...(chunk as JobRow[]));
  }
  const jobByRef = Object.fromEntries(allJobs.map((j) => [j.reference, j]));

  // ── 3. Clients → source_account_id (fallback for jobs without account_id) ─
  const clientIds = [...new Set(
    allJobs.filter((j) => !j.account_id).map((j) => j.client_id).filter((id): id is string => !!id),
  )];

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
    allClients
      .filter((c) => c.source_account_id)
      .map((c) => [c.id, c.source_account_id as string]),
  );

  // ── 4. Accounts ───────────────────────────────────────────────────────────
  const rawAccountIds = [...new Set([
    ...allJobs.map((j) => j.account_id),
    ...allClients.map((c) => c.source_account_id),
    ...invoices.map((i) => i.source_account_id as string | null | undefined),
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
  let noScheduledDate = 0;
  let noAccount = 0;
  let sameDate = 0;

  for (const inv of invoices) {
    const job = jobByRef[inv.job_reference as string];
    const anchorStr = job?.scheduled_date ?? job?.created_at ?? null;
    if (!anchorStr) { noScheduledDate++; continue; }

    // Resolve account: invoice direct → job direct → client fallback
    const accountId =
      (inv.source_account_id as string | null) ||
      job.account_id ||
      (job.client_id ? accountIdByClientId[job.client_id] : null);

    const account = accountId ? accountById[accountId] : undefined;
    if (!account?.payment_terms) { noAccount++; continue; }

    const anchor = new Date(anchorStr.length === 10 ? anchorStr + "T12:00:00" : anchorStr);
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

  if (dryRun) {
    return NextResponse.json({ updated: 0, noScheduledDate, noAccount, sameDate, changes, dryRun: true });
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

  return NextResponse.json({ updated: updatedCount, noScheduledDate, noAccount, sameDate, changes });
}
