import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import {
  fetchOpenReceivableInvoices,
  repairInvoiceAccounts,
} from "@/lib/billing-invoice-account-repair";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient as createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ADMIN_ROLES = new Set(["admin", "manager"]);

/**
 * POST /api/billing/repair-invoice-accounts
 * Body: { invoiceIds?: string[], persist?: boolean, backfillClients?: boolean }
 *
 * Resolves B2B account links for open receivables and optionally persists
 * invoices.source_account_id (and backfills clients.source_account_id).
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

  let invoiceIds: string[] | undefined;
  let persist = true;
  let backfillClients = true;
  try {
    const body = await req.json().catch(() => ({}));
    if (Array.isArray(body.invoiceIds)) {
      invoiceIds = body.invoiceIds.filter((id: unknown) => typeof id === "string" && id.length > 0);
    }
    if (body.persist === false) persist = false;
    if (body.backfillClients === false) backfillClients = false;
  } catch {
    /* no body */
  }

  const admin = createServiceClient();

  try {
    const invoices = await fetchOpenReceivableInvoices(admin, invoiceIds);
    if (invoices.length === 0) {
      return NextResponse.json({
        ok: true,
        linked: 0,
        unlinked: 0,
        updated: 0,
        byAccount: {},
        clientBackfills: 0,
        skippedInvalid: 0,
        accounts: [],
        total: 0,
      });
    }

    const result = await repairInvoiceAccounts(admin, {
      invoices,
      persist,
      backfillClients,
    });

    return NextResponse.json({
      ok: true,
      linked: result.linked,
      unlinked: result.unlinked,
      updated: result.updated,
      byAccount: result.byAccount,
      clientBackfills: result.clientBackfills,
      skippedInvalid: result.skippedInvalid,
      accounts: result.accounts,
      total: invoices.length,
    });
  } catch (e) {
    console.error("[repair-invoice-accounts]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Repair failed" },
      { status: 500 },
    );
  }
}
