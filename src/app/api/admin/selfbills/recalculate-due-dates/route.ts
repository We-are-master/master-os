import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { partnerFieldSelfBillPaymentDueDate } from "@/lib/self-bill-period";

export const dynamic = "force-dynamic";

const ADMIN_ROLES = new Set(["admin", "manager"]);
const SKIP_STATUSES = new Set(["paid"]);
const CHUNK = 200;
const UPDATE_CHUNK = 50;

/**
 * POST /api/admin/selfbills/recalculate-due-dates
 * Body: { dryRun?: boolean }
 *
 * For each non-paid self-bill:
 *   1. Resolve partner.payment_terms
 *   2. Compute due_date = partnerFieldSelfBillPaymentDueDate(week_end, terms)
 *   3. Batch update changed rows
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

  // ── 1. Eligible self-bills ────────────────────────────────────────────────
  const { data: rawBills, error: billsErr } = await admin
    .from("self_bills")
    .select("id, reference, partner_id, week_end, due_date, status")
    .not("week_end", "is", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (billsErr) {
    return NextResponse.json({ error: "Failed to fetch self-bills" }, { status: 500 });
  }

  const bills = ((rawBills ?? []) as {
    id: string;
    reference: string;
    partner_id: string | null;
    week_end: string;
    due_date: string | null;
    status: string;
  }[]).filter((b) => !SKIP_STATUSES.has(b.status) && b.partner_id);

  if (bills.length === 0) {
    return NextResponse.json({ updated: 0, noPartner: 0, sameDate: 0, changes: [] });
  }

  // ── 2. Partners → payment_terms ──────────────────────────────────────────
  const partnerIds = [...new Set(bills.map((b) => b.partner_id as string))];
  const partnerTermsMap = new Map<string, string | null>();
  for (let i = 0; i < partnerIds.length; i += CHUNK) {
    const { data: chunk } = await admin
      .from("partners")
      .select("id, payment_terms")
      .in("id", partnerIds.slice(i, i + CHUNK));
    for (const p of chunk ?? []) {
      const pr = p as { id: string; payment_terms?: string | null };
      partnerTermsMap.set(pr.id, pr.payment_terms ?? null);
    }
  }

  // ── 3. Compute new due dates ─────────────────────────────────────────────
  type Change = { id: string; reference: string; old_due_date: string | null; new_due_date: string };
  const changes: Change[] = [];
  let noPartner = 0;
  let sameDate = 0;

  for (const bill of bills) {
    const pid = bill.partner_id!;
    if (!partnerTermsMap.has(pid)) { noPartner++; continue; }

    const terms = partnerTermsMap.get(pid) ?? null;
    const newDueDate = partnerFieldSelfBillPaymentDueDate(bill.week_end, terms);
    const oldDueDate = bill.due_date ? String(bill.due_date).slice(0, 10) : null;

    if (newDueDate !== oldDueDate) {
      changes.push({ id: bill.id, reference: bill.reference, old_due_date: oldDueDate, new_due_date: newDueDate });
    } else {
      sameDate++;
    }
  }

  const debug = {
    billsTotal: bills.length,
    partnersFound: partnerTermsMap.size,
    noPartner,
    sameDate,
    toUpdate: changes.length,
  };

  if (dryRun) {
    return NextResponse.json({ updated: 0, noPartner, sameDate, changes, dryRun: true, debug });
  }

  // ── 4. Batch update ──────────────────────────────────────────────────────
  let updatedCount = 0;
  for (let i = 0; i < changes.length; i += UPDATE_CHUNK) {
    await Promise.all(
      changes.slice(i, i + UPDATE_CHUNK).map((c) =>
        admin.from("self_bills").update({ due_date: c.new_due_date }).eq("id", c.id),
      ),
    );
    updatedCount += Math.min(UPDATE_CHUNK, changes.length - i);
  }

  return NextResponse.json({ updated: updatedCount, noPartner, sameDate, changes, debug });
}
