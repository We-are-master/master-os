import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveNominalBillingParty } from "@/lib/account-billing-addressee";
import { buildInvoiceEmailHTML } from "@/lib/invoice-email-template";
import { parseFrontendSetup, resolveInvoicePlatformFeePct } from "@/lib/frontend-setup";
import type { Invoice, Job } from "@/types/database";

/**
 * GET /api/invoices/email-preview?invoiceId=xxx
 * Returns the HTML body of the invoice / payment receipt email for dashboard preview.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const invoiceId = req.nextUrl.searchParams.get("invoiceId") ?? undefined;
  if (!invoiceId || !isValidUUID(invoiceId)) {
    return NextResponse.json({ error: "Valid invoiceId is required" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { data: invoice, error: invErr } = await admin
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();

  if (invErr || !invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const inv = invoice as Invoice;
  let job: Job | null = null;
  let quoteReference: string | null = null;
  let clientId: string | null = null;

  if (inv.job_reference?.trim()) {
    const { data: jobRow } = await admin
      .from("jobs")
      .select(
        "id, reference, title, client_id, property_address, service_type, completed_date, quote_id, client_price, extras_amount, commission, partner_agreed_value, partner_cost, materials_cost",
      )
      .eq("reference", inv.job_reference.trim())
      .is("deleted_at", null)
      .maybeSingle();
    job = (jobRow ?? null) as Job | null;
    clientId = job?.client_id ?? null;

    const quoteId = job?.quote_id ?? null;
    if (quoteId) {
      const { data: quote } = await admin.from("quotes").select("reference").eq("id", quoteId).maybeSingle();
      quoteReference = (quote as { reference?: string } | null)?.reference?.trim() ?? null;
    }
  }

  const billing = clientId
    ? await resolveNominalBillingParty(admin, {
        clientId,
        fallbackName: inv.client_name,
        fallbackEmail: null,
      })
    : null;

  const { data: company } = await admin
    .from("company_settings")
    .select("frontend_setup")
    .limit(1)
    .maybeSingle();
  const tradeFeeOptions = {
    defaultPlatformFeePct: resolveInvoicePlatformFeePct(
      parseFrontendSetup((company as { frontend_setup?: unknown } | null)?.frontend_setup),
    ),
  };

  const html = buildInvoiceEmailHTML(
    inv,
    {
      clientName: billing?.displayName ?? inv.client_name,
      jobTitle: job?.title ?? inv.job_reference ?? "Job",
      propertyAddress: job?.property_address ?? null,
      serviceType: (job as { service_type?: string | null } | null)?.service_type ?? null,
      completionDate: job?.completed_date ?? inv.created_at,
      quoteReference,
    },
    job,
    { tradeFeeOptions },
  );

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
