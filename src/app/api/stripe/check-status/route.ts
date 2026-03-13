import { NextRequest, NextResponse } from "next/server";
import { requireStripe } from "@/lib/stripe";
import { createClient } from "@supabase/supabase-js";
import { requireAuth, isValidUUID } from "@/lib/auth-api";

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SERVICE_ROLE_KEY!,
  );
}

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

    const sessions = await stripe.checkout.sessions.list({
      payment_link: paymentLinkId,
      limit: 5,
    });

    const completedSession = sessions.data.find((s) => s.payment_status === "paid");
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
