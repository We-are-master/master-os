import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { requireAuth } from "@/lib/auth-api";
import { requireStaffPermission } from "@/lib/staff-permission";
import { requireStripe } from "@/lib/stripe";

/**
 * Detalhe de um recebimento do Stripe para o relatório do pagamento no job card
 * (dono, 15/10/2026). Só leitura. Aceita o id da sessão de checkout (cs_…) ou
 * da cobrança (pi_…) que o OS grava na nota do pagamento.
 */
export async function GET(req: Request) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const perm = await requireStaffPermission(auth, "jobs");
  if (perm instanceof NextResponse) return perm;

  const ref = new URL(req.url).searchParams.get("ref")?.trim() ?? "";
  if (!/^(cs|pi)_[A-Za-z0-9_]+$/.test(ref)) {
    return NextResponse.json({ error: "Invalid reference" }, { status: 400 });
  }

  try {
    const stripe = requireStripe();
    let pi: Stripe.PaymentIntent | null = null;
    let customerEmail: string | null = null;
    if (ref.startsWith("cs_")) {
      const session = await stripe.checkout.sessions.retrieve(ref, {
        expand: ["payment_intent.latest_charge.balance_transaction", "payment_intent.payment_method"],
      });
      customerEmail = session.customer_details?.email ?? session.customer_email ?? null;
      pi = typeof session.payment_intent === "string" ? null : session.payment_intent ?? null;
    } else {
      pi = await stripe.paymentIntents.retrieve(ref, {
        expand: ["latest_charge.balance_transaction", "payment_method"],
      });
    }
    const charge = pi && typeof pi.latest_charge !== "string" ? (pi.latest_charge as Stripe.Charge | null) : null;
    const bt =
      charge && typeof charge.balance_transaction !== "string"
        ? (charge.balance_transaction as Stripe.BalanceTransaction | null)
        : null;
    const card =
      charge?.payment_method_details?.card ??
      (pi?.payment_method && typeof pi.payment_method !== "string" ? pi.payment_method.card : null) ??
      null;
    return NextResponse.json({
      ref,
      paymentIntentId: pi?.id ?? null,
      status: pi?.status ?? null,
      amountGbp: charge ? charge.amount / 100 : pi ? pi.amount_received / 100 : null,
      paidAtIso: charge ? new Date(charge.created * 1000).toISOString() : null,
      cardBrand: card?.brand ?? null,
      cardLast4: card?.last4 ?? null,
      feeGbp: bt ? bt.fee / 100 : null,
      netGbp: bt ? bt.net / 100 : null,
      receiptUrl: charge?.receipt_url ?? null,
      customerEmail: customerEmail ?? charge?.billing_details?.email ?? null,
      refundedGbp: charge ? charge.amount_refunded / 100 : null,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Stripe lookup failed" }, { status: 502 });
  }
}
