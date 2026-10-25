import { NextRequest, NextResponse } from "next/server";
import { aposEntradaDaCotacaoPaga } from "@/lib/quote-deposit-paid-server";
import { requireStripe } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/service";
import { syncJobAfterStripeInvoicePaid } from "@/lib/stripe-job-sync";
import { applyOsPayLinkPayment } from "@/lib/stripe-pay-link-payment";
import { saveCardFromCheckoutSession } from "@/lib/stripe-card-charge";

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

  // Evento já processado com sucesso (a Stripe reentrega o mesmo evento): não credita de novo.
  // O registro entra só no fim, depois de tudo certo: se algo falhar no meio, a Stripe tenta
  // de novo e o evento é processado na tentativa seguinte (22/10/2026).
  const { data: jaFeito } = await supabaseAdmin.from("processed_events").select("event_id").eq("provider", "stripe").eq("event_id", event.id).maybeSingle();
  if (jaFeito) return NextResponse.json({ received: true, duplicate: true });

  if (event.type === "checkout.session.completed" || event.type === "payment_intent.succeeded") {
    const session = event.data.object as unknown as Record<string, unknown>;
    const metadata = (session.metadata ?? {}) as Record<string, string>;
    // Cobrança no cartão salvo (`os_charge`) é lançada no ledger por quem cobrou
    // (lib/stripe-card-charge); nunca pode cair no ramo antigo que marca a fatura paga inteira.
    const invoiceId = metadata.os_charge ? undefined : metadata.invoice_id;

    if (invoiceId) {
      const { data: invRow } = await supabaseAdmin
        .from("invoices")
        .select("amount, invoice_kind, job_reference")
        .eq("id", invoiceId)
        .maybeSingle();
      const inv = (invRow ?? {}) as { amount?: number; invoice_kind?: string | null; job_reference?: string | null };
      const invAmt = Number(inv.amount ?? 0);

      let fullyPaid = true;
      if (event.type === "checkout.session.completed" && metadata.pay_link === "os") {
        // OS pay-link sessions can be partial (?pct= deposit): credit only the
        // charged amount instead of force-marking the invoice fully paid.
        fullyPaid = await applyOsPayLinkPayment(supabaseAdmin, invoiceId, {
          id: String(session.id ?? ""),
          payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : null,
          amount_total: Number(session.amount_total ?? 0),
        });
        // Preço da equipe fechado pelo Harvey no WhatsApp: ele confirma o pagamento na conversa
        // (16/10/2026). Só age se a conversa gravou este job como checkout; avisa uma vez.
        if (inv.job_reference) {
          const { avisarPagamentoNoWhatsAppPelaReferencia } = await import("@/lib/harvey-wa/motor");
          await avisarPagamentoNoWhatsAppPelaReferencia(inv.job_reference).catch((e) =>
            console.error("Stripe webhook: WhatsApp payment notice failed", e),
          );
        }
        // Sinal de quem paga no cartão: guarda o cartão pro restante (Fase 0).
        await saveCardFromCheckoutSession(supabaseAdmin, {
          customer: typeof session.customer === "string" ? session.customer : null,
          payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : null,
          metadata,
        }).catch((e) => console.error("Stripe webhook: save card failed", e));
      } else {
        await supabaseAdmin.from("invoices").update({
          stripe_payment_status: "paid",
          stripe_paid_at: new Date().toISOString(),
          status: "paid",
          paid_date: new Date().toISOString().split("T")[0],
          amount_paid: invAmt,
        }).eq("id", invoiceId);

        await syncJobAfterStripeInvoicePaid(supabaseAdmin, invoiceId);
      }

      // When a deposit invoice is paid, advance the originating quote from
      // `awaiting_payment` to `converted_to_job`. Safe no-op if the invoice
      // isn't a deposit or the job/quote can't be resolved.
      // Sinal pago pelo link do OS (reserva do Harvey, cotação): a confirmação do booking sai agora,
      // mesmo sem parceiro. A própria função confere status, data, sinal e se já saiu (uma vez só).
      if (inv.job_reference) {
        try {
          const { data: jobDoPagamento } = await supabaseAdmin.from("jobs").select("id").eq("reference", inv.job_reference).is("deleted_at", null).maybeSingle();
          const jid = (jobDoPagamento as { id?: string } | null)?.id;
          if (jid) {
            const { dispatchJobCreatedZendesk } = await import("@/lib/zendesk-lifecycle");
            await dispatchJobCreatedZendesk({ jobId: jid, client: supabaseAdmin });
          }
        } catch (e) {
          console.error("Stripe webhook: booking confirmation after payment failed", e);
        }
      }
      if (fullyPaid && inv.invoice_kind === "deposit" && inv.job_reference) {
        // Entrada paga: cotação vai para converted_to_job e o parceiro recebe o aviso (15/10/2026).
        try {
          await aposEntradaDaCotacaoPaga(supabaseAdmin, inv.job_reference, "stripe_webhook");
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

  await supabaseAdmin
    .from("processed_events")
    .insert({ provider: "stripe", event_id: event.id, kind: event.type })
    .then(({ error }) => { if (error && error.code !== "23505") console.error("[stripe webhook] processed_events:", error.message); });
  return NextResponse.json({ received: true });
}
