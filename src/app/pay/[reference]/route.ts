import { NextRequest, NextResponse } from "next/server";
import { billingReferenceCandidates } from "@/lib/billing-reference";
import { requireStripe } from "@/lib/stripe";
import { accountPaysByCard, CARD_ON_FILE_ON } from "@/lib/stripe-card-charge";
import { createServiceClient } from "@/lib/supabase/service";
import { depositAmountFromPercent } from "@/lib/quote-deposit";
import { saldoDoLinkDePagamento, valorFixoDoLink } from "@/lib/pay-link-amount";
import { isLegacyMisclassifiedCustomerPayment } from "@/lib/job-payment-ledger";
import { isJobPaymentsDeletedAtMissing } from "@/lib/supabase-schema-compat";
import { textoDoCartaoSalvo } from "@/lib/texto-cartao-salvo";
import { customerBalanceCap, loadJobPromotionAmount } from "@/lib/agent-model/promotion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EPS = 0.02;
/** Stripe minimum charge for GBP. */
const MIN_CHARGE_GBP = 0.3;

/**
 * Public pay link: `/pay/INV-XXXX` charges the invoice's open balance,
 * `/pay/INV-XXXX?pct=50` charges that percentage of the open balance (deposit).
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
      .select("id, reference, client_name, amount, amount_paid, status, job_reference, stripe_customer_email, invoice_kind")
      // O cliente pode chegar com o prefixo antigo (RCP-) ou o novo (INV-): é a mesma fatura.
      .in("reference", billingReferenceCandidates(reference))
      .order("created_at", { ascending: false })
      .limit(1)
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
      invoice_kind?: string | null;
    };

    if (inv.status === "cancelled") {
      return htmlMessage("Invoice cancelled", "This invoice has been cancelled and can no longer be paid. Please contact Fixfy for an up-to-date invoice.", 410);
    }

    let jobId = "";
    let jobClientId: string | null = null;
    let jobPrice: { client_price?: number | null; extras_amount?: number | null; total_client_price?: number | null } | null = null;
    // Fatura semanal: o saldo é o da fatura (vários jobs); o job da referência não manda no valor.
    if (inv.job_reference?.trim() && inv.invoice_kind !== "weekly_batch") {
      const { data: jobRow } = await admin
        .from("jobs")
        .select("id, client_id, client_price, extras_amount, total_client_price")
        .eq("reference", inv.job_reference.trim())
        .maybeSingle();
      if (jobRow?.id) {
        jobId = jobRow.id as string;
        jobClientId = (jobRow as { client_id?: string | null }).client_id ?? null;
        jobPrice = jobRow as { client_price?: number | null; extras_amount?: number | null; total_client_price?: number | null };
      }
    }

    /**
     * Promoção da Fixfy (mig 313) nunca é cobrada do cliente.
     *
     * O saldo do link é o da fatura, mas fatura criada antes de a promoção
     * existir no job (ou a preço cheio por engano) cobraria a promoção. Com
     * promoção no job, o link nunca passa de preço + extras − promoção − o que
     * já foi pago.
     */
    const promotion = jobId && jobPrice ? await loadJobPromotionAmount(admin, jobId) : 0;
    const [faturasDoJob, pagoNoJob] = jobId
      ? await Promise.all([
          countJobInvoices(admin, inv.job_reference!.trim()),
          sumJobCustomerPayments(admin, jobId),
        ])
      : [0, null];

    // Rede de segurança contra fatura com `amount` abaixo do job (RCP-2026-917, 14/10/2026):
    // fatura única do job cobra o total do job menos o que já entrou, nunca "pago" antes disso.
    let balance = saldoDoLinkDePagamento({
      valorFatura: Number(inv.amount ?? 0),
      pagoFatura: Number(inv.amount_paid ?? 0),
      faturaPaga: inv.status === "paid",
      totalDoJob: jobPrice
        ? Math.max(Number(jobPrice.client_price ?? 0), Number(jobPrice.total_client_price ?? 0)) + Number(jobPrice.extras_amount ?? 0) - Math.max(0, promotion)
        : null,
      pagoNoJob,
      faturaUnicaDoJob: faturasDoJob === 1,
    });
    if (jobPrice && promotion > 0) {
      const cap = customerBalanceCap({
        clientPrice: jobPrice.client_price,
        extrasAmount: jobPrice.extras_amount,
        promotionAmount: promotion,
        amountPaid: Math.max(Number(inv.amount_paid ?? 0), pagoNoJob ?? 0),
      });
      balance = Math.min(balance, cap);
    }
    if (balance <= EPS) {
      return NextResponse.redirect(`${appUrl}/payment-success?ref=${encodeURIComponent(reference)}`, 303);
    }

    /**
     * `?amount=NN.NN` cobra um valor FIXO, e ganha do `?pct` quando os dois vêm.
     *
     * É o caso do extra: somei £50 ao job, quero o link de £50. Porcentagem não
     * serve porque a fatia se recalcula a cada clique — o saldo muda com
     * pagamento e com outro extra, e a mesma URL cobraria outro número amanhã.
     *
     * O teto continua sendo o saldo aberto: link nunca cobra mais do que se
     * deve, mesmo que o valor escrito seja maior.
     */
    const amountParam = req.nextUrl.searchParams.get("amount");
    let amount: number;
    let pct: number;
    if (amountParam != null && amountParam.trim() !== "") {
      const fixo = valorFixoDoLink(amountParam, balance);
      if (!fixo.ok) {
        return fixo.motivo === "abaixo_do_minimo"
          ? htmlMessage("Amount too small", "The amount on this link is below the card payment minimum. Please contact Fixfy.", 400)
          : htmlMessage("Link not valid", "This payment link is not valid any more. Please contact Fixfy.", 400);
      }
      amount = fixo.valor;
      // `pct` segue nos metadados porque o webhook usa 100 para decidir se a
      // fatura foi paga por inteiro. Valor fixo só fecha a fatura se cobrir o
      // saldo todo.
      pct = fixo.valor >= balance - EPS ? 100 : Math.max(1, Math.min(99, Math.round((fixo.valor / balance) * 100)));
    } else {
      // ?pct=NN charges NN% of the open balance; absent or out of range → full balance.
      const pctRaw = Number(req.nextUrl.searchParams.get("pct"));
      pct = Number.isFinite(pctRaw) && pctRaw >= 1 && pctRaw <= 99 ? Math.round(pctRaw) : 100;
      amount = pct === 100 ? balance : depositAmountFromPercent(balance, pct);
      if (amount < MIN_CHARGE_GBP) {
        return htmlMessage("Amount too small", "The amount due on this link is below the card payment minimum. Please contact Fixfy.", 400);
      }
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

    // Quem paga no cartão (conta card_upfront ou sem conta) sempre deixa o cartão salvo:
    // no sinal o restante é cobrado sozinho no final review (Fase 0, dono 09/10/2026); no
    // pagamento cheio ele fica para extra aprovado ou cancelamento tardio (dono, 14/10/2026).
    const saveCard = CARD_ON_FILE_ON() && !!jobId && (await accountPaysByCard(admin, jobClientId));
    let savedCustomerId: string | null = null;
    if (saveCard && jobClientId) {
      const { data: cli } = await admin.from("clients").select("stripe_customer_id").eq("id", jobClientId).maybeSingle();
      savedCustomerId = (cli as { stripe_customer_id?: string | null } | null)?.stripe_customer_id ?? null;
    }
    if (saveCard) metadata.save_card = "1";
    const balanceAfter = Math.max(0, Math.round((balance - amount) * 100) / 100);
    // O que fica para depois é o do JOB, não só desta fatura (16/10/2026): a entrada da cotação
    // é uma fatura própria paga por inteiro, e o texto dizia "You pay in full now" com o saldo
    // ainda por cobrar no cartão no fim do job.
    const restanteDoJob = jobPrice
      ? Math.max(
          0,
          Math.round(
            (Math.max(Number(jobPrice.client_price ?? 0), Number(jobPrice.total_client_price ?? 0)) + Number(jobPrice.extras_amount ?? 0) - Math.max(0, promotion) - (pagoNoJob ?? 0) - amount) * 100,
          ) / 100,
        )
      : balanceAfter;
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
              name: pct < 100 ? `Invoice ${reference} · ${pct}% deposit` : `Invoice ${reference}`,
              ...(clientName ? { description: `Payment for ${clientName}` } : {}),
            },
          },
        },
      ],
      metadata,
      ...(saveCard
        ? {
            ...(savedCustomerId ? { customer: savedCustomerId } : { customer_creation: "always" as const }),
            payment_intent_data: { setup_future_usage: "off_session" as const },
            custom_text: {
              submit: {
                message: textoDoCartaoSalvo({ pct, restante: Math.max(balanceAfter, restanteDoJob) }),
              },
            },
          }
        : {}),
      ...(!savedCustomerId && inv.stripe_customer_email?.trim() ? { customer_email: inv.stripe_customer_email.trim() } : {}),
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

type AdminClient = ReturnType<typeof createServiceClient>;

/** Faturas vivas do job que dividem o total (cancelada e lote semanal não contam). */
async function countJobInvoices(admin: AdminClient, jobReference: string): Promise<number> {
  const { data, error } = await admin
    .from("invoices")
    .select("id, status, invoice_kind")
    .eq("job_reference", jobReference)
    .is("deleted_at", null);
  if (error) {
    console.error("Pay link: job invoices read failed", jobReference, error);
    return 0;
  }
  return ((data ?? []) as { status?: string | null; invoice_kind?: string | null }[]).filter(
    (r) => r.status !== "cancelled" && r.invoice_kind !== "weekly_batch",
  ).length;
}

/** Pagamentos de cliente no razão do job; null quando não deu para ler (aí vale só a fatura). */
async function sumJobCustomerPayments(admin: AdminClient, jobId: string): Promise<number | null> {
  type Row = { type: string; amount: number; note?: string | null };
  const base = () =>
    admin.from("job_payments").select("type, amount, note").eq("job_id", jobId).in("type", ["customer_deposit", "customer_final"]);
  let { data, error } = await base().is("deleted_at", null);
  if (error && isJobPaymentsDeletedAtMissing(error)) ({ data, error } = await base());
  if (error) {
    console.error("Pay link: job payments read failed", jobId, error);
    return null;
  }
  const total = ((data ?? []) as Row[])
    .filter((p) => !isLegacyMisclassifiedCustomerPayment(p))
    .reduce((s, p) => s + Number(p.amount ?? 0), 0);
  return Math.round(total * 100) / 100;
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
