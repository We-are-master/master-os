import { NextRequest, NextResponse } from "next/server";
import { requireStripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { invoiceBalanceDue } from "@/lib/invoice-balance";
import { depositAmountFromPercent } from "@/lib/quote-deposit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EPS = 0.02;
/** Stripe minimum charge for GBP. */
const MIN_CHARGE_GBP = 0.3;

/**
 * Public pay link: `/pay/RCP-XXXX` charges the invoice's open balance,
 * `/pay/RCP-XXXX?pct=50` charges that percentage of the open balance (deposit).
 *
 * A Checkout Session is created per click with the amount computed NOW, so the
 * URL never goes stale when the invoice amount changes or a partial payment
 * lands — unlike Stripe Payment Links, whose price is frozen at creation.
 * The webhook matches the session back to the invoice via `metadata.invoice_id`
 * and `metadata.pay_link = "os"`.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ reference: string }> }) {
  const { reference: rawRef } = await ctx.params;
  const reference = decodeURIComponent(rawRef ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{2,40}$/.test(reference)) {
    return htmlMessage("Invalid link", "This payment link is not valid.", 400);
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") ||
    "https://app.getfixfy.com";

  try {
    const admin = createServiceClient();
    const { data: invRow } = await admin
      .from("invoices")
      .select("id, reference, client_name, amount, amount_paid, status, job_reference, stripe_customer_email")
      .eq("reference", reference)
      .maybeSingle();

    if (!invRow) {
      return htmlMessage("Invoice not found", "We could not find an invoice for this link. Please contact Fixfy if you believe this is a mistake.", 404);
    }
    const inv = invRow as {
      id: string;
      reference: string;
      client_name?: string | null;
      amount?: number;
      amount_paid?: number;
      status?: string | null;
      job_reference?: string | null;
      stripe_customer_email?: string | null;
    };

    if (inv.status === "cancelled") {
      return htmlMessage("Invoice cancelled", "This invoice has been cancelled and can no longer be paid. Please contact Fixfy for an up-to-date invoice.", 410);
    }

    const balance = invoiceBalanceDue({ amount: Number(inv.amount ?? 0), amount_paid: Number(inv.amount_paid ?? 0) });
    if (inv.status === "paid" || balance <= EPS) {
      return NextResponse.redirect(`${appUrl}/payment-success?ref=${encodeURIComponent(reference)}`, 303);
    }

    // ?pct=NN charges NN% of the open balance; absent or out of range → full balance.
    const pctRaw = Number(req.nextUrl.searchParams.get("pct"));
    const pct = Number.isFinite(pctRaw) && pctRaw >= 1 && pctRaw <= 99 ? Math.round(pctRaw) : 100;
    const amount = pct === 100 ? balance : depositAmountFromPercent(balance, pct);
    if (amount < MIN_CHARGE_GBP) {
      return htmlMessage("Amount too small", "The amount due on this link is below the card payment minimum. Please contact Fixfy.", 400);
    }

    let jobId = "";
    if (inv.job_reference?.trim()) {
      const { data: jobRow } = await admin
        .from("jobs")
        .select("id")
        .eq("reference", inv.job_reference.trim())
        .maybeSingle();
      if (jobRow?.id) jobId = jobRow.id as string;
    }

    const metadata: Record<string, string> = {
      pay_link: "os",
      invoice_id: inv.id,
      reference,
      pct: String(pct),
    };
    if (jobId) metadata.job_id = jobId;

    const clientName = inv.client_name?.trim();
    const stripe = requireStripe();
    // Metadata stays on the session only (not payment_intent_data): the webhook's
    // legacy payment_intent.succeeded branch marks invoices FULLY paid, which
    // would be wrong for a deposit charge.
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: Math.round(amount * 100),
            product_data: {
              name: pct < 100 ? `Invoice ${reference} — ${pct}% deposit` : `Invoice ${reference}`,
              ...(clientName ? { description: `Payment for ${clientName}` } : {}),
            },
          },
        },
      ],
      metadata,
      ...(inv.stripe_customer_email?.trim() ? { customer_email: inv.stripe_customer_email.trim() } : {}),
      success_url: `${appUrl}/payment-success?ref=${encodeURIComponent(reference)}`,
    });

    if (!session.url) {
      return htmlMessage("Something went wrong", "We could not start the payment. Please try again or contact Fixfy.", 500);
    }
    return NextResponse.redirect(session.url, 303);
  } catch (err) {
    console.error("Pay link error:", reference, err);
    const message = err instanceof Error ? err.message : "";
    if (message.includes("not configured")) {
      return htmlMessage("Payments unavailable", "Card payments are temporarily unavailable. Please contact Fixfy.", 503);
    }
    return htmlMessage("Something went wrong", "We could not start the payment. Please try again or contact Fixfy.", 500);
  }
}

function htmlMessage(title: string, body: string, status: number): NextResponse {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} · Fixfy</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f5f5f4; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .card { max-width: 26rem; width: 100%; margin: 1.5rem; background: #fff; border: 1px solid #e7e5e4; border-radius: 1rem; box-shadow: 0 10px 25px rgba(0,0,0,.06); padding: 2rem; text-align: center; }
  h1 { font-size: 1.25rem; color: #292524; margin: 0 0 .5rem; }
  p { color: #57534e; margin: 0; line-height: 1.5; }
</style>
</head>
<body><div class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></div></body>
</html>`;
  return new NextResponse(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
