import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { accountFinalEmailPolicyFromRow } from "@/lib/account-final-email-policy";
import { resolveJobBillingContact } from "@/lib/job-billing-contact";
import type { Account } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type JobBillingContactResponse = {
  documentEmail: string | null;
  mode: "end_client" | "account";
  displayName: string;
  canIncludeInvoice: boolean;
};

/**
 * GET /api/jobs/[id]/billing-contact
 *
 * Resolves the billing email for invoice / payment sends using the same rules
 * as Accounts → Finance tab (billing_type + finance_email vs client email).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!id || !isValidUUID(id)) {
    return NextResponse.json({ error: "Valid job id is required" }, { status: 400 });
  }

  let admin;
  try {
    admin = createServiceClient();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server configuration error";
    return NextResponse.json({ error: message }, { status: 503 });
  }

  try {
    const { data: job, error: jobErr } = await admin
      .from("jobs")
      .select("id, client_id, client_name, quote_id, invoice_id")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (jobErr || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const row = job as {
      id: string;
      client_id?: string | null;
      client_name?: string | null;
      quote_id?: string | null;
      invoice_id?: string | null;
    };
    const billing = await resolveJobBillingContact(admin, {
      id: row.id,
      client_id: row.client_id,
      client_name: row.client_name,
      quote_id: row.quote_id,
      invoice_id: row.invoice_id,
    });

    let canIncludeInvoice = true;
    const aid = billing.sourceAccountId?.trim();
    if (aid) {
      const { data: acc } = await admin.from("accounts").select("*").eq("id", aid).is("deleted_at", null).maybeSingle();
      canIncludeInvoice = accountFinalEmailPolicyFromRow((acc ?? null) as Account | null).canIncludeInvoice;
    }

    const body: JobBillingContactResponse = {
      documentEmail: billing.documentEmail,
      mode: billing.mode,
      displayName: billing.displayName,
      canIncludeInvoice,
    };
    return NextResponse.json(body);
  } catch (e) {
    console.error("[billing-contact]", e);
    const message = e instanceof Error ? e.message : "Could not load billing contact";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
