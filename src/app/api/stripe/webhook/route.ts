import { NextRequest, NextResponse } from "next/server";
import { requireStripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { syncJobAfterStripeInvoicePaid } from "@/lib/stripe-job-sync";

export async function POST(req: NextRequest) {
  const supabaseAdmin = createServiceClient();
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Missing signature or webhook secret" }, { status: 400 });
  }

  let event;
  try {
    const stripe = requireStripe();
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    const message = err instanceof Error ? err.message : "";
    if (message.includes("not configured")) {
      return NextResponse.json({ error: message }, { status: 503 });
    }
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed" || event.type === "payment_intent.succeeded") {
    const session = event.data.object as unknown as Record<string, unknown>;
    const metadata = (session.metadata ?? {}) as Record<string, string>;
    const invoiceId = metadata.invoice_id;

    if (invoiceId) {
      const { data: invRow } = await supabaseAdmin
        .from("invoices")
        .select("amount, invoice_kind, job_reference")
        .eq("id", invoiceId)
        .maybeSingle();
      const inv = (invRow ?? {}) as { amount?: number; invoice_kind?: string | null; job_reference?: string | null };
      const invAmt = Number(inv.amount ?? 0);

      await supabaseAdmin.from("invoices").update({
        stripe_payment_status: "paid",
        stripe_paid_at: new Date().toISOString(),
        status: "paid",
        paid_date: new Date().toISOString().split("T")[0],
        amount_paid: invAmt,
      }).eq("id", invoiceId);

      await syncJobAfterStripeInvoicePaid(supabaseAdmin, invoiceId);

      // When a deposit invoice is paid, advance the originating quote from
      // `awaiting_payment` to `converted_to_job`. Safe no-op if the invoice
      // isn't a deposit or the job/quote can't be resolved.
      if (inv.invoice_kind === "deposit" && inv.job_reference) {
        try {
          const { data: jobRow } = await supabaseAdmin
            .from("jobs")
            .select("id, quote_id")
            .eq("reference", inv.job_reference)
            .maybeSingle();
          const quoteId = (jobRow as { quote_id?: string | null } | null)?.quote_id ?? null;
          if (quoteId) {
            const { data: quoteRow } = await supabaseAdmin
              .from("quotes")
              .select("id, reference, status")
              .eq("id", quoteId)
              .maybeSingle();
            const q = (quoteRow ?? null) as { id: string; reference?: string | null; status?: string | null } | null;
            if (q && q.status === "awaiting_payment") {
              const { error: qErr } = await supabaseAdmin
                .from("quotes")
                .update({ status: "converted_to_job", updated_at: new Date().toISOString() })
                .eq("id", q.id);
              if (qErr) {
                console.error("Stripe webhook: quote -> converted_to_job update failed", qErr);
              } else {
                void supabaseAdmin.from("audit_logs").insert({
                  entity_type: "quote",
                  entity_id: q.id,
                  entity_ref: q.reference ?? null,
                  action: "status_changed",
                  field_name: "status",
                  old_value: "awaiting_payment",
                  new_value: "converted_to_job",
                  metadata: { invoice_id: invoiceId, deposit_paid: true, source: "stripe_webhook" },
                });
              }
            }
          }
        } catch (e) {
          console.error("Stripe webhook: advance quote after deposit failed", e);
        }
      }
    }
  }

  if (event.type === "payment_intent.payment_failed") {
    const pi = event.data.object as unknown as Record<string, unknown>;
    const metadata = (pi.metadata ?? {}) as Record<string, string>;
    const invoiceId = metadata.invoice_id;

    if (invoiceId) {
      await supabaseAdmin.from("invoices").update({
        stripe_payment_status: "failed",
      }).eq("id", invoiceId);
    }
  }

  return NextResponse.json({ received: true });
}
