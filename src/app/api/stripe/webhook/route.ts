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
      await supabaseAdmin.from("invoices").update({
        stripe_payment_status: "paid",
        stripe_paid_at: new Date().toISOString(),
        status: "paid",
        paid_date: new Date().toISOString().split("T")[0],
      }).eq("id", invoiceId);

      await syncJobAfterStripeInvoicePaid(supabaseAdmin, invoiceId);
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
