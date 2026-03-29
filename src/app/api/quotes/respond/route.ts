import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyQuoteResponseToken } from "@/lib/quote-response-token";
import { requireStripe } from "@/lib/stripe";
import { syncInvoiceCollectionStagesForJob } from "@/lib/invoice-collection";
import { applyJobDbCompat, prepareJobRowForInsert } from "@/lib/job-schema-compat";
import { isPostgrestWriteRetryableError } from "@/lib/postgrest-errors";

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SERVICE_ROLE_KEY!,
  );
}

const baseUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/**
 * POST /api/quotes/respond
 * Public: customer accepts or rejects a quote via email link.
 * On accept with deposit_required > 0: creates job, deposit invoice, Stripe payment link; returns paymentLinkUrl.
 * Body: { token: string, action: "accept" | "reject", rejectionReason?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, action, rejectionReason } = body as {
      token?: string;
      action?: string;
      rejectionReason?: string;
    };

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }
    if (action !== "accept" && action !== "reject") {
      return NextResponse.json({ error: "Action must be accept or reject" }, { status: 400 });
    }

    const quoteId = verifyQuoteResponseToken(token);
    if (!quoteId) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
    }

    const supabase = getServiceSupabase();

    if (action === "reject") {
      const { data: quote, error: fetchError } = await supabase
        .from("quotes")
        .select("id, reference, status")
        .eq("id", quoteId)
        .single();

      if (fetchError || !quote) {
        return NextResponse.json({ error: "Quote not found" }, { status: 404 });
      }

      const updates: { status: string; rejection_reason?: string } = {
        status: "rejected",
        ...(typeof rejectionReason === "string" && rejectionReason.trim() ? { rejection_reason: rejectionReason.trim() } : {}),
      };

      const { error: updateError } = await supabase
        .from("quotes")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", quoteId);

      if (updateError) {
        console.error("Quote respond update error:", updateError);
        return NextResponse.json({ error: "Failed to update quote" }, { status: 500 });
      }

      await supabase.from("audit_logs").insert({
        entity_type: "quote",
        entity_id: quoteId,
        entity_ref: quote.reference,
        action: "status_changed",
        field_name: "status",
        old_value: quote.status,
        new_value: "rejected",
        metadata: updates.rejection_reason ? { rejection_reason: updates.rejection_reason } : {},
      });

      return NextResponse.json({
        success: true,
        action: "reject",
        reference: quote.reference,
        message: "Quote declined. Thank you for letting us know.",
      });
    }

    // Accept: need full quote for possible job + invoice + Stripe
    const { data: quote, error: fetchError } = await supabase
      .from("quotes")
      .select("id, reference, status, title, client_name, client_email, deposit_required, scope, property_address, partner_id, partner_name, partner_cost, total_value")
      .eq("id", quoteId)
      .single();

    if (fetchError || !quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    const depositRequired = Number(quote.deposit_required ?? 0);

    if (depositRequired > 0) {
      // Create job, deposit invoice, and Stripe payment link; then mark quote accepted
      let stripe: ReturnType<typeof requireStripe>;
      try {
        stripe = requireStripe();
      } catch {
        return NextResponse.json(
          { error: "Payment is not configured. Please contact us to complete your acceptance." },
          { status: 503 },
        );
      }

      const { data: jobRefRow } = await supabase.rpc("next_job_ref");
      const jobReference = (jobRefRow as string) ?? `JOB-${Date.now()}`;

      const { data: invRefRow } = await supabase.rpc("next_invoice_ref");
      const invoiceReference = (invRefRow as string) ?? `INV-${Date.now()}`;

      const totalValue = Number(quote.total_value ?? 0);
      const finalBalance = Math.max(0, totalValue - depositRequired);

      const now = new Date().toISOString();
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 14);
      const dueDateStr = dueDate.toISOString().split("T")[0];

      const hasPartner = !!(quote.partner_id?.trim() || (quote.partner_name && String(quote.partner_name).trim()));
      const baseJobRow: Record<string, unknown> = {
        reference: jobReference,
        title: quote.title ?? "Job from quote",
        client_name: quote.client_name ?? "",
        property_address: quote.property_address ?? "Address to be confirmed",
        partner_id: quote.partner_id ?? null,
        partner_name: quote.partner_name ?? null,
        quote_id: quoteId,
        status: hasPartner ? "scheduled" : "unassigned",
        progress: 0,
        current_phase: 0,
        total_phases: 2,
        job_type: "fixed",
        client_price: totalValue,
        extras_amount: 0,
        partner_cost: Number(quote.partner_cost ?? 0),
        materials_cost: 0,
        margin_percent: 0,
        partner_agreed_value: Number(quote.partner_cost ?? 0),
        finance_status: "unpaid",
        service_value: totalValue,
        report_submitted: false,
        report_1_uploaded: false,
        report_1_approved: false,
        report_2_uploaded: false,
        report_2_approved: false,
        report_3_uploaded: false,
        report_3_approved: false,
        partner_payment_1: 0,
        partner_payment_1_paid: false,
        partner_payment_2: 0,
        partner_payment_2_paid: false,
        partner_payment_3: 0,
        partner_payment_3_paid: false,
        customer_deposit: depositRequired,
        customer_deposit_paid: false,
        customer_final_payment: finalBalance,
        customer_final_paid: false,
        cash_in: 0,
        cash_out: 0,
        expenses: 0,
        commission: 0,
        vat: 0,
        scope: quote.scope ?? null,
      };
      const jobInsert = prepareJobRowForInsert(baseJobRow);
      let { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert(jobInsert)
        .select("id, reference")
        .single();
      if (jobError && isPostgrestWriteRetryableError(jobError)) {
        const retry = await supabase
          .from("jobs")
          .insert(applyJobDbCompat(baseJobRow))
          .select("id, reference")
          .single();
        job = retry.data;
        jobError = retry.error;
      }

      if (jobError || !job) {
        console.error("Quote accept: job creation failed", jobError);
        return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
      }

      const { data: invoice, error: invError } = await supabase
        .from("invoices")
        .insert({
          reference: invoiceReference,
          client_name: quote.client_name ?? "",
          job_reference: job.reference,
          amount: depositRequired,
          status: "pending",
          due_date: dueDateStr,
          collection_stage: "awaiting_deposit",
          collection_stage_locked: false,
          invoice_kind: "deposit",
        })
        .select("id")
        .single();

      if (invError || !invoice) {
        console.error("Quote accept: invoice creation failed", invError);
        await supabase
          .from("jobs")
          .update({ deleted_at: new Date().toISOString(), deleted_by: "system" })
          .eq("id", job.id);
        return NextResponse.json({ error: "Failed to create deposit invoice" }, { status: 500 });
      }

      const product = await stripe.products.create({
        name: `Deposit — ${quote.reference}`,
        description: `Deposit for ${quote.client_name ?? "Client"} — ${quote.reference}`,
        metadata: {
          invoice_id: invoice.id,
          reference: invoiceReference,
          quote_id: quoteId,
          job_id: job.id,
        },
      });

      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(depositRequired * 100),
        currency: "gbp",
      });

      const paymentLink = await stripe.paymentLinks.create({
        line_items: [{ price: price.id, quantity: 1 }],
        metadata: { invoice_id: invoice.id, reference: invoiceReference, job_id: job.id },
        after_completion: {
          type: "redirect",
          redirect: { url: `${baseUrl()}/payment-success?ref=${encodeURIComponent(quote.reference)}&from=quote` },
        },
      });

      await supabase
        .from("invoices")
        .update({
          stripe_payment_link_id: paymentLink.id,
          stripe_payment_link_url: paymentLink.url,
          stripe_payment_status: "pending",
          stripe_customer_email: quote.client_email ?? null,
        })
        .eq("id", invoice.id);

      await supabase.from("jobs").update({ invoice_id: invoice.id }).eq("id", job.id);

      if (finalBalance > 0.01) {
        const { data: finRefRow } = await supabase.rpc("next_invoice_ref");
        const finalRef = (finRefRow as string) ?? `INV-F-${Date.now()}`;
        const { error: finInvErr } = await supabase.from("invoices").insert({
          reference: finalRef,
          client_name: quote.client_name ?? "",
          job_reference: job.reference,
          amount: finalBalance,
          status: "pending",
          due_date: dueDateStr,
          collection_stage: "awaiting_deposit",
          collection_stage_locked: false,
          invoice_kind: "final",
        });
        if (finInvErr) {
          console.error("Quote accept: final invoice creation failed", finInvErr);
        }
      }

      await syncInvoiceCollectionStagesForJob(supabase, job.id);

      const { error: quoteUpdateErr } = await supabase
        .from("quotes")
        .update({
          status: "accepted",
          customer_accepted: true,
          updated_at: now,
        })
        .eq("id", quoteId);

      if (quoteUpdateErr) {
        console.error("Quote accept: quote update failed", quoteUpdateErr);
      }

      await supabase.from("audit_logs").insert({
        entity_type: "quote",
        entity_id: quoteId,
        entity_ref: quote.reference,
        action: "status_changed",
        field_name: "status",
        old_value: quote.status,
        new_value: "accepted",
        metadata: { job_id: job.id, invoice_id: invoice.id, deposit_invoice: true },
      });

      return NextResponse.json({
        success: true,
        action: "accept",
        reference: quote.reference,
        message: "Quote accepted. Complete your deposit payment to confirm.",
        paymentLinkUrl: paymentLink.url,
      });
    }

    // Accept with no deposit: just update quote
    const updates: { status: string; customer_accepted?: boolean } = {
      status: "accepted",
      customer_accepted: true,
    };

    const { error: updateError } = await supabase
      .from("quotes")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", quoteId);

    if (updateError) {
      console.error("Quote respond update error:", updateError);
      return NextResponse.json({ error: "Failed to update quote" }, { status: 500 });
    }

    await supabase.from("audit_logs").insert({
      entity_type: "quote",
      entity_id: quoteId,
      entity_ref: quote.reference,
      action: "status_changed",
      field_name: "status",
      old_value: quote.status,
      new_value: "accepted",
    });

    return NextResponse.json({
      success: true,
      action: "accept",
      reference: quote.reference,
      message: "Quote accepted. We will be in touch shortly.",
    });
  } catch (err) {
    console.error("Quote respond error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
