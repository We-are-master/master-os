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
    const supabaseAdmin = getSupabaseAdmin();
    const { invoiceId, amount, clientName, reference, customerEmail } = await req.json();

    if (!invoiceId || !amount || !clientName || !reference) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!isValidUUID(invoiceId)) {
      return NextResponse.json({ error: "Invalid invoiceId" }, { status: 400 });
    }

    const product = await stripe.products.create({
      name: `Invoice ${reference}`,
      description: `Payment for ${clientName} — ${reference}`,
      metadata: { invoice_id: invoiceId, reference },
    });

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(amount * 100),
      currency: "gbp",
    });

    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { invoice_id: invoiceId, reference },
      after_completion: {
        type: "redirect",
        redirect: { url: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/payment-success?ref=${reference}` },
      },
      ...(customerEmail ? { custom_fields: [] } : {}),
    });

    const { error } = await supabaseAdmin.from("invoices").update({
      stripe_payment_link_id: paymentLink.id,
      stripe_payment_link_url: paymentLink.url,
      stripe_payment_status: "pending",
      stripe_customer_email: customerEmail || null,
    }).eq("id", invoiceId);

    if (error) {
      console.error("Supabase update error:", error);
    }

    return NextResponse.json({
      paymentLinkId: paymentLink.id,
      paymentLinkUrl: paymentLink.url,
    });
  } catch (err) {
    console.error("Stripe error:", err);
    const message = err instanceof Error ? err.message : "Failed to create payment link";
    const status = message.includes("not configured") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
