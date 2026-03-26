import { NextRequest, NextResponse } from "next/server";
import { requireStripe } from "@/lib/stripe";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { syncJobAfterStripeInvoicePaid } from "@/lib/stripe-job-sync";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const stripe = requireStripe();
    const supabaseAdmin = createServiceClient();
    const { invoiceId, paymentLinkId } = await req.json();

    if (!invoiceId || !paymentLinkId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!isValidUUID(invoiceId)) {
      return NextResponse.json({ error: "Invalid invoiceId" }, { status: 400 });
    }

    // Verify that the paymentLinkId stored on the invoice matches what the caller provided.
    // This prevents a confused-deputy attack where a paid session from link B is used to mark invoice A as paid.
    const { data: invRow } = await supabaseAdmin
      .from("invoices")
      .select("stripe_payment_link_id")
      .eq("id", invoiceId)
      .maybeSingle();

    if (!invRow) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    if (invRow.stripe_payment_link_id && invRow.stripe_payment_link_id !== paymentLinkId) {
      return NextResponse.json({ error: "Payment link mismatch" }, { status: 400 });
    }

    const sessions = await stripe.checkout.sessions.list({
      payment_link: paymentLinkId,
      limit: 5,
    });

    // Only consider sessions whose metadata references this invoice.
    const completedSession = sessions.data.find(
      (s) =>
        s.payment_status === "paid" &&
        (!s.metadata?.invoice_id || s.metadata.invoice_id === invoiceId),
    );
    const latestSession = sessions.data[0];

    let paymentStatus: string = "pending";
    let paidAt: string | null = null;

    if (completedSession) {
      paymentStatus = "paid";
      paidAt = completedSession.created
        ? new Date(completedSession.created * 1000).toISOString()
        : new Date().toISOString();
    } else if (latestSession?.payment_status === "unpaid" && latestSession.status === "expired") {
      paymentStatus = "expired";
    } else if (sessions.data.length === 0) {
      paymentStatus = "pending";
    }

    await supabaseAdmin.from("invoices").update({
      stripe_payment_status: paymentStatus,
      ...(paymentStatus === "paid" ? {
        stripe_paid_at: paidAt,
        status: "paid",
        paid_date: paidAt ? new Date(paidAt).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
      } : {}),
    }).eq("id", invoiceId);

    if (paymentStatus === "paid") {
      await syncJobAfterStripeInvoicePaid(supabaseAdmin, invoiceId);
    }

    return NextResponse.json({
      paymentStatus,
      paidAt,
      sessionsCount: sessions.data.length,
      latestSessionStatus: latestSession?.status ?? null,
      latestPaymentStatus: latestSession?.payment_status ?? null,
      customerEmail: completedSession?.customer_details?.email ?? latestSession?.customer_details?.email ?? null,
    });
  } catch (err) {
    console.error("Stripe check error:", err);
    const message = err instanceof Error ? err.message : "Failed to check status";
    const status = message.includes("not configured") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
