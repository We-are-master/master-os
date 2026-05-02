import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyQuoteResponseToken } from "@/lib/quote-response-token";
import { requireStripe } from "@/lib/stripe";
import { syncInvoicesFromJobCustomerPayments } from "@/lib/sync-invoices-from-job-payments";
import { maybeCompleteAwaitingPaymentJob } from "@/lib/sync-job-after-invoice-paid";
import { applyJobDbCompat, prepareJobRowForInsert } from "@/lib/job-schema-compat";
import { capJobImagesArray, coerceJobImagesArray } from "@/lib/job-images";
import { isPostgrestWriteRetryableError } from "@/lib/postgrest-errors";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { ensureWeeklySelfBillForJob } from "@/services/self-bills";
import { resolveNominalBillingParty } from "@/lib/account-billing-addressee";

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SERVICE_ROLE_KEY!,
  );
}

const baseUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function withServerTiming(body: unknown, status: number, marks: Array<[string, number]>) {
  const metric = marks
    .filter(([, v]) => Number.isFinite(v) && v >= 0)
    .map(([k, v]) => `${k};dur=${Math.round(v)}`)
    .join(", ");
  const res = NextResponse.json(body, { status });
  if (metric) res.headers.set("Server-Timing", metric);
  return res;
}

/**
 * POST /api/quotes/respond
 * Public: customer accepts or rejects a quote via email link.
 * On accept with deposit_required > 0: creates job, deposit invoice, Stripe payment link; returns paymentLinkUrl.
 * Body: { token: string, action: "accept" | "reject", rejectionReason?: string }
 */
export async function POST(req: NextRequest) {
  // Per-IP rate limit defeats brute force against quote response tokens.
  // Tokens are signed JWTs so brute force is already infeasible, but the
  // limit also stops misbehaving clients from spamming the endpoint.
  const ip = getClientIp(req);
  const rl = checkRateLimit(`quote-respond:${ip}`, 10, 10 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const startedAt = performance.now();
  const marks: Array<[string, number]> = [];
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
      const tLookup = performance.now();
      const { data: quote, error: fetchError } = await supabase
        .from("quotes")
        .select("id, reference, status")
        .eq("id", quoteId)
        .single();
      marks.push(["quote_lookup", performance.now() - tLookup]);

      if (fetchError || !quote) {
        marks.push(["total", performance.now() - startedAt]);
        return withServerTiming({ error: "Quote not found" }, 404, marks);
      }

      const updates: { status: string; rejection_reason?: string } = {
        status: "rejected",
        ...(typeof rejectionReason === "string" && rejectionReason.trim() ? { rejection_reason: rejectionReason.trim() } : {}),
      };

      const tUpdate = performance.now();
      const { error: updateError } = await supabase
        .from("quotes")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", quoteId);
      marks.push(["quote_update", performance.now() - tUpdate]);

      if (updateError) {
        console.error("Quote respond update error:", updateError);
        marks.push(["total", performance.now() - startedAt]);
        return withServerTiming({ error: "Failed to update quote" }, 500, marks);
      }

      /** Audit log is downstream: customer doesn't wait for it. */
      void supabase.from("audit_logs").insert({
        entity_type: "quote",
        entity_id: quoteId,
        entity_ref: quote.reference,
        action: "status_changed",
        field_name: "status",
        old_value: quote.status,
        new_value: "rejected",
        metadata: updates.rejection_reason ? { rejection_reason: updates.rejection_reason } : {},
      }).then(({ error }) => { if (error) console.error("audit_logs insert (reject)", error); });

      marks.push(["total", performance.now() - startedAt]);
      return withServerTiming({
        success: true,
        action: "reject",
        reference: quote.reference,
        message: "Quote declined. Thank you for letting us know.",
      }, 200, marks);
    }

    // Accept: need full quote for possible job + invoice + Stripe
    const tLookup = performance.now();
    const { data: quote, error: fetchError } = await supabase
      .from("quotes")
      .select(
        "id, reference, status, title, client_id, client_name, client_email, deposit_required, scope, property_address, partner_id, partner_name, partner_cost, total_value, images, request_id",
      )
      .eq("id", quoteId)
      .single();
    marks.push(["quote_lookup", performance.now() - tLookup]);

    if (fetchError || !quote) {
      marks.push(["total", performance.now() - startedAt]);
      return withServerTiming({ error: "Quote not found" }, 404, marks);
    }

    const qClientId = (quote as { client_id?: string | null }).client_id?.trim() ?? "";
    const acceptBilling = await resolveNominalBillingParty(supabase, {
      clientId: qClientId,
      fallbackName: quote.client_name,
      fallbackEmail: quote.client_email,
    });
    const invClientName = acceptBilling.displayName;
    const invStripeEmail = acceptBilling.documentEmail ?? quote.client_email ?? null;

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

      const tRefs = performance.now();
      const [{ data: jobRefRow }, { data: invRefRow }] = await Promise.all([
        supabase.rpc("next_job_ref"),
        supabase.rpc("next_invoice_ref"),
      ]);
      marks.push(["next_refs", performance.now() - tRefs]);
      const jobReference = (jobRefRow as string) ?? `JOB-${Date.now()}`;
      const invoiceReference = (invRefRow as string) ?? `INV-${Date.now()}`;

      const totalValue = Number(quote.total_value ?? 0);
      const finalBalance = Math.max(0, totalValue - depositRequired);

      const now = new Date().toISOString();
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 14);
      const dueDateStr = dueDate.toISOString().split("T")[0];

      const hasPartner = !!(quote.partner_id?.trim() || (quote.partner_name && String(quote.partner_name).trim()));
      let jobImages = coerceJobImagesArray((quote as { images?: unknown }).images);
      const reqId = (quote as { request_id?: string | null }).request_id?.trim();
      if (jobImages.length === 0 && reqId) {
        const { data: reqRow } = await supabase.from("service_requests").select("images").eq("id", reqId).maybeSingle();
        jobImages = capJobImagesArray(coerceJobImagesArray(reqRow?.images));
      } else {
        jobImages = capJobImagesArray(jobImages);
      }
      const baseJobRow: Record<string, unknown> = {
        reference: jobReference,
        title: quote.title ?? "Job from quote",
        client_id: qClientId || null,
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
        images: jobImages,
        // Carry the Zendesk lineage so partner notifications on the new
        // job land on the same ticket / side conversation.
        external_source: (quote as { external_source?: string | null }).external_source ?? null,
        external_ref: (quote as { external_ref?: string | null }).external_ref ?? null,
        zendesk_side_conversation_id: (quote as { zendesk_side_conversation_id?: string | null }).zendesk_side_conversation_id ?? null,
      };
      const tJob = performance.now();
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
      marks.push(["job_insert", performance.now() - tJob]);

      if (jobError || !job) {
        console.error("Quote accept: job creation failed", jobError);
        marks.push(["total", performance.now() - startedAt]);
        return withServerTiming({ error: "Failed to create job" }, 500, marks);
      }

      const tInv = performance.now();
      const { data: invoice, error: invError } = await supabase
        .from("invoices")
        .insert({
          reference: invoiceReference,
          client_name: invClientName,
          job_reference: job.reference,
          amount: depositRequired,
          status: "draft",
          due_date: dueDateStr,
          collection_stage: "awaiting_deposit",
          collection_stage_locked: false,
          invoice_kind: "deposit",
        })
        .select("id")
        .single();
      marks.push(["invoice_insert", performance.now() - tInv]);

      if (invError || !invoice) {
        console.error("Quote accept: invoice creation failed", invError);
        await supabase
          .from("jobs")
          .update({ deleted_at: new Date().toISOString(), deleted_by: "system" })
          .eq("id", job.id);
        marks.push(["total", performance.now() - startedAt]);
        return withServerTiming({ error: "Failed to create deposit invoice" }, 500, marks);
      }

      const tStripe = performance.now();
      const product = await stripe.products.create({
        name: `Deposit — ${quote.reference}`,
        description: `Deposit for ${invClientName} — ${quote.reference}`,
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
      marks.push(["stripe_calls", performance.now() - tStripe]);

      const tWrites = performance.now();
      /** Final invoice ref RPC can run in parallel with the post-Stripe writes. */
      const finalRefPromise: Promise<string | null> = finalBalance > 0.01
        ? Promise.resolve(supabase.rpc("next_invoice_ref")).then(({ data }) => (data as string | null) ?? `INV-F-${Date.now()}`)
        : Promise.resolve(null);

      /** Three updates that touch different rows can all happen in parallel. */
      await Promise.all([
        supabase
          .from("invoices")
          .update({
            stripe_payment_link_id: paymentLink.id,
            stripe_payment_link_url: paymentLink.url,
            stripe_payment_status: "pending",
            stripe_customer_email: invStripeEmail,
          })
          .eq("id", invoice.id),
        supabase.from("jobs").update({ invoice_id: invoice.id }).eq("id", job.id),
        supabase
          .from("quotes")
          .update({ status: "awaiting_payment", customer_accepted: true, updated_at: now })
          .eq("id", quoteId)
          .then(({ error }) => { if (error) console.error("Quote accept: quote update failed", error); }),
      ]);

      const finalRef = await finalRefPromise;
      if (finalRef) {
        const { error: finInvErr } = await supabase.from("invoices").insert({
          reference: finalRef,
          client_name: invClientName,
          job_reference: job.reference,
          amount: finalBalance,
          status: "draft",
          due_date: dueDateStr,
          collection_stage: "awaiting_deposit",
          collection_stage_locked: false,
          invoice_kind: "final",
        });
        if (finInvErr) {
          console.error("Quote accept: final invoice creation failed", finInvErr);
        }
      }

      /** Downstream syncs + audit log don't gate the response — fire-and-forget. */
      void (async () => {
        try {
          await syncInvoicesFromJobCustomerPayments(supabase, job.id);
          await maybeCompleteAwaitingPaymentJob(supabase, job.id);
        } catch (e) {
          console.error("Quote accept: downstream sync failed", e);
        }
      })();
      if (hasPartner) {
        void ensureWeeklySelfBillForJob({ ...baseJobRow, id: job.id, reference: job.reference } as Parameters<typeof ensureWeeklySelfBillForJob>[0])
          .then((sbId) => {
            if (sbId) void supabase.from("jobs").update({ self_bill_id: sbId }).eq("id", job.id);
          })
          .catch((e) => console.error("Quote accept: self-bill create failed", e));
      }
      void supabase.from("audit_logs").insert({
        entity_type: "quote",
        entity_id: quoteId,
        entity_ref: quote.reference,
        action: "status_changed",
        field_name: "status",
        old_value: quote.status,
        new_value: "awaiting_payment",
        metadata: { job_id: job.id, invoice_id: invoice.id, deposit_invoice: true },
      }).then(({ error }) => { if (error) console.error("audit_logs insert (accept)", error); });
      marks.push(["db_updates", performance.now() - tWrites]);
      marks.push(["total", performance.now() - startedAt]);

      return withServerTiming({
        success: true,
        action: "accept",
        reference: quote.reference,
        message: "Quote accepted. Complete your deposit payment to confirm.",
        paymentLinkUrl: paymentLink.url,
      }, 200, marks);
    }

    // Accept with no deposit: create the job + full-amount final invoice immediately,
    // and mark quote as converted_to_job (skipping the Awaiting Payment stage).
    const totalValueNoDep = Number(quote.total_value ?? 0);

    const tRefsNoDep = performance.now();
    const [{ data: jobRefRowNoDep }, { data: invRefRowNoDep }] = await Promise.all([
      supabase.rpc("next_job_ref"),
      supabase.rpc("next_invoice_ref"),
    ]);
    marks.push(["next_refs", performance.now() - tRefsNoDep]);
    const jobReferenceNoDep = (jobRefRowNoDep as string) ?? `JOB-${Date.now()}`;
    const invoiceReferenceNoDep = (invRefRowNoDep as string) ?? `INV-${Date.now()}`;

    const nowNoDep = new Date().toISOString();
    const dueDateNoDep = new Date();
    dueDateNoDep.setDate(dueDateNoDep.getDate() + 14);
    const dueDateStrNoDep = dueDateNoDep.toISOString().split("T")[0];

    const hasPartnerNoDep = !!(quote.partner_id?.trim() || (quote.partner_name && String(quote.partner_name).trim()));
    let jobImagesNoDep = coerceJobImagesArray((quote as { images?: unknown }).images);
    const reqIdNoDep = (quote as { request_id?: string | null }).request_id?.trim();
    if (jobImagesNoDep.length === 0 && reqIdNoDep) {
      const { data: reqRow } = await supabase.from("service_requests").select("images").eq("id", reqIdNoDep).maybeSingle();
      jobImagesNoDep = capJobImagesArray(coerceJobImagesArray(reqRow?.images));
    } else {
      jobImagesNoDep = capJobImagesArray(jobImagesNoDep);
    }

    const baseJobRowNoDep: Record<string, unknown> = {
      reference: jobReferenceNoDep,
      title: quote.title ?? "Job from quote",
      client_id: qClientId || null,
      client_name: quote.client_name ?? "",
      property_address: quote.property_address ?? "Address to be confirmed",
      partner_id: quote.partner_id ?? null,
      partner_name: quote.partner_name ?? null,
      quote_id: quoteId,
      status: hasPartnerNoDep ? "scheduled" : "unassigned",
      progress: 0,
      current_phase: 0,
      total_phases: 2,
      job_type: "fixed",
      client_price: totalValueNoDep,
      extras_amount: 0,
      partner_cost: Number(quote.partner_cost ?? 0),
      materials_cost: 0,
      margin_percent: 0,
      partner_agreed_value: Number(quote.partner_cost ?? 0),
      finance_status: "unpaid",
      service_value: totalValueNoDep,
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
      customer_deposit: 0,
      customer_deposit_paid: false,
      customer_final_payment: totalValueNoDep,
      customer_final_paid: false,
      cash_in: 0,
      cash_out: 0,
      expenses: 0,
      commission: 0,
      vat: 0,
      scope: quote.scope ?? null,
      images: jobImagesNoDep,
      external_source: (quote as { external_source?: string | null }).external_source ?? null,
      external_ref: (quote as { external_ref?: string | null }).external_ref ?? null,
      zendesk_side_conversation_id: (quote as { zendesk_side_conversation_id?: string | null }).zendesk_side_conversation_id ?? null,
    };

    const tJobNoDep = performance.now();
    const jobInsertNoDep = prepareJobRowForInsert(baseJobRowNoDep);
    let { data: jobNoDep, error: jobErrorNoDep } = await supabase
      .from("jobs")
      .insert(jobInsertNoDep)
      .select("id, reference")
      .single();
    if (jobErrorNoDep && isPostgrestWriteRetryableError(jobErrorNoDep)) {
      const retry = await supabase
        .from("jobs")
        .insert(applyJobDbCompat(baseJobRowNoDep))
        .select("id, reference")
        .single();
      jobNoDep = retry.data;
      jobErrorNoDep = retry.error;
    }
    marks.push(["job_insert", performance.now() - tJobNoDep]);

    if (jobErrorNoDep || !jobNoDep) {
      console.error("Quote accept (no deposit): job creation failed", jobErrorNoDep);
      marks.push(["total", performance.now() - startedAt]);
      return withServerTiming({ error: "Failed to create job" }, 500, marks);
    }

    const tInvNoDep = performance.now();
    const { data: finalInvoice, error: finalInvError } = await supabase
      .from("invoices")
      .insert({
        reference: invoiceReferenceNoDep,
        client_name: invClientName,
        job_reference: jobNoDep.reference,
        amount: totalValueNoDep,
        status: "draft",
        due_date: dueDateStrNoDep,
        collection_stage: "awaiting_final",
        collection_stage_locked: false,
        invoice_kind: "final",
      })
      .select("id")
      .single();
    marks.push(["invoice_insert", performance.now() - tInvNoDep]);

    if (finalInvError || !finalInvoice) {
      console.error("Quote accept (no deposit): final invoice creation failed", finalInvError);
      // Job was created but invoice failed: we leave the job in place so the operator can investigate,
      // and surface a clear error so the customer can retry (idempotency is handled by the operator).
      marks.push(["total", performance.now() - startedAt]);
      return withServerTiming({ error: "Failed to create final invoice" }, 500, marks);
    }

    await Promise.all([
      supabase.from("jobs").update({ invoice_id: finalInvoice.id }).eq("id", jobNoDep.id),
      supabase
        .from("quotes")
        .update({ status: "converted_to_job", customer_accepted: true, updated_at: nowNoDep })
        .eq("id", quoteId)
        .then(({ error }) => { if (error) console.error("Quote accept (no deposit): quote update failed", error); }),
    ]);

    /** Downstream syncs + audit log don't gate the response — fire-and-forget. */
    void (async () => {
      try {
        await syncInvoicesFromJobCustomerPayments(supabase, jobNoDep.id);
      } catch (e) {
        console.error("Quote accept (no deposit): downstream sync failed", e);
      }
    })();
    if (hasPartnerNoDep) {
      void ensureWeeklySelfBillForJob({ ...baseJobRowNoDep, id: jobNoDep.id, reference: jobNoDep.reference } as Parameters<typeof ensureWeeklySelfBillForJob>[0])
        .then((sbId) => {
          if (sbId) void supabase.from("jobs").update({ self_bill_id: sbId }).eq("id", jobNoDep.id);
        })
        .catch((e) => console.error("Quote accept (no deposit): self-bill create failed", e));
    }
    void supabase.from("audit_logs").insert({
      entity_type: "quote",
      entity_id: quoteId,
      entity_ref: quote.reference,
      action: "status_changed",
      field_name: "status",
      old_value: quote.status,
      new_value: "converted_to_job",
      metadata: { job_id: jobNoDep.id, invoice_id: finalInvoice.id, deposit_invoice: false },
    }).then(({ error }) => { if (error) console.error("audit_logs insert (accept no deposit)", error); });

    marks.push(["total", performance.now() - startedAt]);
    return withServerTiming({
      success: true,
      action: "accept",
      reference: quote.reference,
      message: "Quote accepted. Your job has been created and a final invoice is on the way.",
      jobReference: jobNoDep.reference,
    }, 200, marks);
  } catch (err) {
    console.error("Quote respond error:", err);
    marks.push(["total", performance.now() - startedAt]);
    return withServerTiming({ error: "Internal error" }, 500, marks);
  }
}
