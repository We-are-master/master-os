/**
 * Cobrança do restante no cartão salvo (Fase 0, dono 09/10/2026).
 *
 * Quem paga assim: conta `card_upfront` (Fixfy, B2C) e cliente sem conta, quando o
 * sinal de 50% salvou o cartão (`jobs.stripe_payment_method_id`). Dispara no
 * final review, ANTES de o job sair de final check:
 *  - passou: entra em `job_payments` (o resto do final review segue e conclui o job)
 *  - recusou: o job fica em final check com "Card refused"; novas tentativas só nas
 *    recusas que a bandeira permite (1, 3 e 7 dias); o cliente recebe o link.
 *
 * Nunca cobra duas vezes: cada tentativa grava antes uma linha com chave única
 * (`stripe_charge_attempts.idempotency_key`) e a mesma chave vai para a Stripe.
 * A PaymentIntent NUNCA leva `metadata.invoice_id` (o ramo antigo do webhook
 * marcaria a fatura inteira como paga).
 */
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStripe } from "@/lib/stripe";
import { jobCustomerTotal } from "@/lib/job-financials";
import type { Job } from "@/types/database";

export const CARD_ON_FILE_ON = () => process.env.FIXFY_CARD_ON_FILE?.trim() === "on";
const EPS = 0.02;
/** Novas tentativas depois da 1ª recusa, em dias (dono: 1, 3 e 7). */
export const RETRY_SCHEDULE_DAYS = [1, 3, 7];

export type CardChargeOutcome =
  | { status: "charged"; amountGbp: number; paymentIntentId: string; brand?: string | null; last4?: string | null }
  | { status: "refused"; amountGbp: number; reason: string; retryAt: string | null }
  | { status: "requires_action"; amountGbp: number; reason: string }
  | { status: "skipped"; reason: string };

/** Recusa que a bandeira deixa tentar de novo (falta de saldo, recusa genérica temporária). */
export function isRetryableDecline(code: string | null | undefined, declineCode: string | null | undefined): boolean {
  const d = (declineCode ?? "").toLowerCase();
  const c = (code ?? "").toLowerCase();
  const nunca = new Set([
    "lost_card", "stolen_card", "pickup_card", "restricted_card", "do_not_honor_permanent", "do_not_try_again",
    "fraudulent", "merchant_blacklist", "invalid_account", "new_account_information_available", "revocation_of_authorization",
    "revocation_of_all_authorizations", "stop_payment_order", "transaction_not_allowed", "card_not_supported", "currency_not_supported",
    "expired_card", "incorrect_number", "invalid_number", "invalid_cvc", "incorrect_cvc",
  ]);
  if (nunca.has(d) || nunca.has(c)) return false;
  if (c === "authentication_required" || d === "authentication_required") return false;
  return ["insufficient_funds", "generic_decline", "try_again_later", "processing_error", "issuer_not_available", "do_not_honor", "withdrawal_count_limit_exceeded", "card_velocity_exceeded", "approve_with_id", "reenter_transaction"].includes(d || c);
}

/** Próxima tentativa (ISO) depois de `retryCount` tentativas extras já feitas, ou null quando acabou. */
export function nextRetryAt(retryCount: number, from: Date = new Date()): string | null {
  const days = RETRY_SCHEDULE_DAYS[retryCount];
  if (days == null) return null;
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}

function reasonText(code: string | null, declineCode: string | null, message: string | null): string {
  const key = (declineCode || code || "").toLowerCase();
  const map: Record<string, string> = {
    insufficient_funds: "Insufficient funds",
    expired_card: "Card expired",
    authentication_required: "Bank asked the customer to confirm",
    lost_card: "Card reported lost",
    stolen_card: "Card reported stolen",
    generic_decline: "Declined by the bank",
    do_not_honor: "Declined by the bank",
  };
  return map[key] ?? (message?.slice(0, 140) || "Declined by the bank");
}

async function customerBalanceGbp(admin: SupabaseClient, job: Job): Promise<number> {
  const { data } = await admin.from("job_payments").select("*").eq("job_id", job.id);
  const paid = ((data ?? []) as { type: string; amount: number; deleted_at?: string | null }[])
    .filter((p) => !p.deleted_at && (p.type === "customer_deposit" || p.type === "customer_final"))
    .reduce((s, p) => s + Number(p.amount || 0), 0);
  return Math.max(0, Math.round((jobCustomerTotal(job) - paid) * 100) / 100);
}

/** Conta do cliente paga no cartão? Sem conta também paga no cartão. */
export async function accountPaysByCard(admin: SupabaseClient, clientId: string | null | undefined): Promise<boolean> {
  if (!clientId) return true;
  const { data: c } = await admin.from("clients").select("source_account_id").eq("id", clientId).maybeSingle();
  const aid = (c as { source_account_id?: string | null } | null)?.source_account_id;
  if (!aid) return true;
  const { data: a } = await admin.from("accounts").select("collection_mode").eq("id", aid).maybeSingle();
  return (a as { collection_mode?: string | null } | null)?.collection_mode === "card_upfront";
}

/**
 * Cobra o que falta do job no cartão salvo. Seguro para chamar de novo: a chave de
 * idempotência é o job + o valor, então a mesma cobrança nunca sai duas vezes.
 */
export async function chargeJobBalanceOnSavedCard(
  admin: SupabaseClient,
  jobId: string,
  opts: { actorId?: string | null; isRetry?: boolean } = {},
): Promise<CardChargeOutcome> {
  if (!CARD_ON_FILE_ON()) return { status: "skipped", reason: "Card on file is off" };

  const { data: jobRow } = await admin.from("jobs").select("*").eq("id", jobId).maybeSingle();
  const job = jobRow as (Job & {
    stripe_customer_id?: string | null;
    stripe_payment_method_id?: string | null;
    card_charge_hold?: boolean | null;
    card_retry_count?: number | null;
  }) | null;
  if (!job) return { status: "skipped", reason: "Job not found" };
  if (!job.stripe_customer_id || !job.stripe_payment_method_id) return { status: "skipped", reason: "No saved card" };
  if (job.card_charge_hold) return { status: "skipped", reason: "Charge on hold" };
  if (!(await accountPaysByCard(admin, job.client_id))) return { status: "skipped", reason: "Account pays by invoice" };

  const amountGbp = await customerBalanceGbp(admin, job);
  if (amountGbp <= EPS) return { status: "skipped", reason: "Nothing left to pay" };
  const amountPence = Math.round(amountGbp * 100);
  if (amountPence < 30) return { status: "skipped", reason: "Below Stripe minimum" };

  const idempotencyKey = `balance:${job.id}:${amountPence}:${opts.isRetry ? `r${(job.card_retry_count ?? 0) + 1}` : "r0"}`;
  const { data: attempt, error: insErr } = await admin
    .from("stripe_charge_attempts")
    .insert({ job_id: job.id, kind: "balance", amount_pence: amountPence, idempotency_key: idempotencyKey, created_by: opts.actorId ?? null })
    .select("id")
    .single();
  if (insErr) {
    // Chave repetida = essa cobrança já foi feita ou está em andamento.
    return { status: "skipped", reason: "This charge was already attempted" };
  }
  const attemptId = (attempt as { id: string }).id;

  const stripe = requireStripe();
  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: amountPence,
        currency: "gbp",
        customer: job.stripe_customer_id,
        payment_method: job.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        description: `Fixfy ${job.reference}: balance for ${job.title ?? "your job"}`,
        metadata: { os_charge: "balance", job_id: job.id, job_reference: job.reference ?? "", attempt_id: attemptId },
      },
      { idempotencyKey },
    );
    if (pi.status !== "succeeded") {
      await admin.from("stripe_charge_attempts").update({ status: "requires_action", payment_intent_id: pi.id, updated_at: new Date().toISOString() }).eq("id", attemptId);
      await admin.from("jobs").update({ card_charge_status: "requires_action", card_refused_reason: "Bank asked the customer to confirm", card_retry_at: null }).eq("id", job.id);
      return { status: "requires_action", amountGbp, reason: "Bank asked the customer to confirm" };
    }
    await admin.from("job_payments").insert({
      job_id: job.id,
      type: "customer_final",
      amount: amountGbp,
      payment_date: new Date().toISOString().slice(0, 10),
      note: `Stripe auto-charge ${pi.id} · saved card`,
      payment_method: "stripe",
    });
    await admin.from("stripe_charge_attempts").update({ status: "succeeded", payment_intent_id: pi.id, updated_at: new Date().toISOString() }).eq("id", attemptId);
    await admin.from("jobs").update({ card_charge_status: "charged", card_refused_reason: null, card_retry_at: null }).eq("id", job.id);
    const pm = pi.payment_method && typeof pi.payment_method !== "string" ? (pi.payment_method as Stripe.PaymentMethod) : null;
    return { status: "charged", amountGbp, paymentIntentId: pi.id, brand: pm?.card?.brand ?? null, last4: pm?.card?.last4 ?? null };
  } catch (err) {
    const e = err as { code?: string; decline_code?: string; message?: string; raw?: { payment_intent?: { id?: string } } };
    const code = e.code ?? null;
    const decline = e.decline_code ?? null;
    const reason = reasonText(code, decline, e.message ?? null);
    const needsCustomer = code === "authentication_required" || decline === "authentication_required";
    await admin
      .from("stripe_charge_attempts")
      .update({ status: needsCustomer ? "requires_action" : "failed", error_code: code, decline_code: decline, payment_intent_id: e.raw?.payment_intent?.id ?? null, updated_at: new Date().toISOString() })
      .eq("id", attemptId);
    if (needsCustomer) {
      await admin.from("jobs").update({ card_charge_status: "requires_action", card_refused_reason: reason, card_retry_at: null }).eq("id", job.id);
      return { status: "requires_action", amountGbp, reason };
    }
    const retryCount = opts.isRetry ? (job.card_retry_count ?? 0) + 1 : 0;
    const retryAt = isRetryableDecline(code, decline) ? nextRetryAt(retryCount) : null;
    await admin
      .from("jobs")
      .update({ card_charge_status: "refused", card_refused_reason: reason, card_retry_at: retryAt, card_retry_count: retryCount })
      .eq("id", job.id);
    return { status: "refused", amountGbp, reason, retryAt };
  }
}

/**
 * Sinal pago com `metadata.save_card = "1"`: guarda o cliente e o cartão da Stripe no
 * job e no cliente do OS, para o restante ser cobrado no final review.
 */
export async function saveCardFromCheckoutSession(
  admin: SupabaseClient,
  session: { customer?: string | null; payment_intent?: string | null; metadata?: Record<string, string> | null },
): Promise<boolean> {
  const jobId = session.metadata?.job_id;
  if (session.metadata?.save_card !== "1" || !jobId || !session.payment_intent) return false;
  const stripe = requireStripe();
  const pi = await stripe.paymentIntents.retrieve(session.payment_intent, { expand: ["payment_method"] });
  const customerId = (typeof pi.customer === "string" ? pi.customer : pi.customer?.id) ?? session.customer ?? null;
  const pm = pi.payment_method && typeof pi.payment_method !== "string" ? (pi.payment_method as Stripe.PaymentMethod) : null;
  const pmId = pm?.id ?? (typeof pi.payment_method === "string" ? pi.payment_method : null);
  if (!customerId || !pmId) return false;

  await admin
    .from("jobs")
    .update({ stripe_customer_id: customerId, stripe_payment_method_id: pmId, card_charge_status: "saved" })
    .eq("id", jobId);
  const { data: job } = await admin.from("jobs").select("client_id").eq("id", jobId).maybeSingle();
  const clientId = (job as { client_id?: string | null } | null)?.client_id;
  if (clientId) {
    await admin
      .from("clients")
      .update({
        stripe_customer_id: customerId,
        stripe_default_payment_method_id: pmId,
        card_brand: pm?.card?.brand ?? null,
        card_last4: pm?.card?.last4 ?? null,
        card_saved_at: new Date().toISOString(),
        card_consent_version: "2026-10-09",
      })
      .eq("id", clientId);
  }
  return true;
}
