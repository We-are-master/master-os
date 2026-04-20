import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { dueDateIsoFromPaymentTerms } from "@/lib/invoice-payment-terms";

export const dynamic = "force-dynamic";

const ADMIN_ROLES = new Set(["admin", "manager"]);
const SKIP_STATUSES = new Set(["paid", "cancelled"]);

/**
 * POST /api/admin/invoices/recalculate-due-dates
 * Body: { dryRun?: boolean }
 *
 * Recalculates due_date for all non-paid/cancelled invoices using:
 *   job.scheduled_date + account.payment_terms → dueDateIsoFromPaymentTerms
 *
 * Returns { updated, skipped, changes[] } where changes lists every
 * invoice whose due_date was (or would be) modified.
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

  // 1. Fetch all eligible invoices (not paid/cancelled, has job_reference, not deleted)
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
    return NextResponse.json({ updated: 0, skipped: 0, changes: [] });
  }

  // 2. Fetch jobs for all referenced job references
  const jobRefs = [...new Set(invoices.map((i) => i.job_reference as string))];
  const JOB_CHUNK = 200;
  const allJobs: { reference: string; scheduled_date: string | null; account_id: string | null }[] = [];
  for (let i = 0; i < jobRefs.length; i += JOB_CHUNK) {
    const slice = jobRefs.slice(i, i + JOB_CHUNK);
    const { data: chunk } = await admin
      .from("jobs")
      .select("reference, scheduled_date, account_id")
      .in("reference", slice);
    if (chunk) allJobs.push(...(chunk as typeof allJobs));
  }

  const jobByRef = Object.fromEntries(allJobs.map((j) => [j.reference, j]));

  // 3. Fetch accounts for all account_ids
  const rawAccountIds = [
    ...new Set([
      ...allJobs.map((j) => j.account_id),
      ...invoices.map((i) => i.source_account_id as string | null | undefined),
    ].filter((id): id is string => !!id)),
  ];

  const ACC_CHUNK = 200;
  const allAccounts: { id: string; payment_terms: string | null }[] = [];
  for (let i = 0; i < rawAccountIds.length; i += ACC_CHUNK) {
    const slice = rawAccountIds.slice(i, i + ACC_CHUNK);
    const { data: chunk } = await admin
      .from("accounts")
      .select("id, payment_terms")
      .in("id", slice);
    if (chunk) allAccounts.push(...(chunk as typeof allAccounts));
  }

  const accountById = Object.fromEntries(allAccounts.map((a) => [a.id, a]));

  // 4. Compute new due dates
  type Change = { id: string; reference: string; old_due_date: string; new_due_date: string };
  const changes: Change[] = [];
  let skipped = 0;

  for (const inv of invoices) {
    const job = jobByRef[inv.job_reference as string];
    if (!job?.scheduled_date) { skipped++; continue; }

    const account =
      accountById[job.account_id ?? ""] ??
      (inv.source_account_id ? accountById[inv.source_account_id as string] : undefined);
    if (!account?.payment_terms) { skipped++; continue; }

    const anchor = new Date(job.scheduled_date + "T12:00:00");
    const newDueDate = dueDateIsoFromPaymentTerms(anchor, account.payment_terms);

    if (newDueDate !== inv.due_date) {
      changes.push({
        id: inv.id as string,
        reference: inv.reference as string,
        old_due_date: inv.due_date as string,
        new_due_date: newDueDate,
      });
    } else {
      skipped++;
    }
  }

  if (dryRun) {
    return NextResponse.json({ updated: 0, skipped, changes, dryRun: true });
  }

  // 5. Batch update — update in chunks to avoid long transactions
  const UPDATE_CHUNK = 50;
  let updatedCount = 0;
  for (let i = 0; i < changes.length; i += UPDATE_CHUNK) {
    const slice = changes.slice(i, i + UPDATE_CHUNK);
    await Promise.all(
      slice.map((c) =>
        admin.from("invoices").update({ due_date: c.new_due_date }).eq("id", c.id),
      ),
    );
    updatedCount += slice.length;
  }

  return NextResponse.json({ updated: updatedCount, skipped, changes });
}
