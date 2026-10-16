import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { requireStaffPermission } from "@/lib/staff-permission";
import { createServiceClient } from "@/lib/supabase/service";
import { requireStripe } from "@/lib/stripe";
import { customerNetPaid, planCardRefunds, refundNote, splitRefundAcrossLedger, stripeRefsFromNotes, type LedgerRow } from "@/lib/job-refund";
import { reconcileJobCustomerPaymentFlags } from "@/lib/reconcile-job-customer-flags";
import { syncInvoicesFromJobCustomerPayments } from "@/lib/sync-invoices-from-job-payments";
import { syncInvoiceCollectionStagesForJob } from "@/lib/invoice-collection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Refund de cliente no job (dono, 13/10/2026). Só admin: é dinheiro saindo.
 *
 * GET  → quanto o cliente pagou e quanto disso ainda pode voltar para o cartão.
 * POST → { amount, reason, method: "stripe" | "bank_transfer", request_id }
 *
 *   stripe         a Stripe devolve no cartão e o OS registra.
 *   bank_transfer  o OS só REGISTRA. A transferência sai do banco, feita por quem pediu.
 *
 * A ordem importa: a linha entra no razão ANTES de a Stripe ser chamada. Se o banco
 * recusar a linha, nenhum dinheiro saiu. Se a Stripe recusar, a linha é desfeita.
 * O contrário (devolver e não conseguir registrar) deixaria dinheiro fora do livro.
 */
type Ctx = { params: Promise<{ id: string }> };
type JobRow = { id: string; reference: string; invoice_id: string | null };
type Charge = { paymentIntent: string; refundablePence: number; created: number };

async function gate(ctx: Ctx) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const perm = await requireStaffPermission(auth, "manage_jobs");
  if (perm instanceof NextResponse) return perm;
  if (perm.role !== "admin") return NextResponse.json({ error: "Only admins can refund a customer." }, { status: 403 });
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  const admin = createServiceClient();
  const { data: job } = await admin.from("jobs").select("id, reference, invoice_id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return { auth, admin, job: job as JobRow };
}

async function loadLedger(admin: SupabaseClient, jobId: string): Promise<LedgerRow[]> {
  const { data, error } = await admin
    .from("job_payments")
    .select("type, amount, note, payment_method")
    .eq("job_id", jobId)
    .in("type", ["customer_deposit", "customer_final"])
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []) as LedgerRow[];
}

async function loadInvoice(admin: SupabaseClient, job: JobRow): Promise<{ id: string; reference: string; stripe_payment_intent_id: string | null } | null> {
  const cols = "id, reference, stripe_payment_intent_id";
  if (job.invoice_id) {
    const { data } = await admin.from("invoices").select(cols).eq("id", job.invoice_id).maybeSingle();
    if (data) return data as { id: string; reference: string; stripe_payment_intent_id: string | null };
  }
  const { data } = await admin.from("invoices").select(cols).eq("job_reference", job.reference).is("deleted_at", null).order("created_at", { ascending: true }).limit(1).maybeSingle();
  return (data as { id: string; reference: string; stripe_payment_intent_id: string | null } | null) ?? null;
}

/** Cobranças de cartão deste job e quanto de cada uma ainda pode voltar. Mais recente primeiro. */
async function loadCardCharges(stripe: Stripe, rows: LedgerRow[], invoicePi: string | null): Promise<Charge[]> {
  const refs = stripeRefsFromNotes(rows);
  const pis = new Set(refs.paymentIntents);
  if (invoicePi) pis.add(invoicePi);
  for (const cs of refs.checkoutSessions) {
    try {
      const s = await stripe.checkout.sessions.retrieve(cs);
      const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
      if (pi) pis.add(pi);
    } catch {
      /* sessão de outra conta ou de teste: não entra na conta */
    }
  }
  const out: Charge[] = [];
  for (const id of pis) {
    try {
      const pi = await stripe.paymentIntents.retrieve(id, { expand: ["latest_charge"] });
      const ch = pi.latest_charge && typeof pi.latest_charge !== "string" ? pi.latest_charge : null;
      if (pi.status !== "succeeded" || !ch) continue;
      out.push({ paymentIntent: pi.id, refundablePence: Math.max(0, ch.amount_captured - ch.amount_refunded), created: pi.created });
    } catch {
      /* idem */
    }
  }
  return out.sort((a, b) => b.created - a.created);
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const g = await gate(ctx);
  if (g instanceof NextResponse) return g;
  const rows = await loadLedger(g.admin, g.job.id);
  const paid = customerNetPaid(rows).total;
  const inv = await loadInvoice(g.admin, g.job);
  let cardRefundable = 0;
  let cardNote: string | null = null;
  try {
    const charges = await loadCardCharges(requireStripe(), rows, inv?.stripe_payment_intent_id ?? null);
    cardRefundable = Math.min(paid, charges.reduce((s, c) => s + c.refundablePence, 0) / 100);
  } catch (e) {
    cardNote = e instanceof Error ? e.message : "Stripe is not available.";
  }
  return NextResponse.json({ paid, cardRefundable: Math.round(cardRefundable * 100) / 100, cardNote, invoiceRef: inv?.reference ?? null });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await gate(ctx);
  if (g instanceof NextResponse) return g;
  const { admin, job, auth } = g;

  let body: { amount?: unknown; reason?: unknown; method?: unknown; request_id?: unknown; notify_client?: unknown; cancel_job?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const amount = Math.round(Number(body.amount) * 100) / 100;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  const method = body.method === "stripe" ? "stripe" : body.method === "bank_transfer" ? "bank_transfer" : null;
  const requestId = typeof body.request_id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(body.request_id) ? body.request_id : null;
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Enter the amount to refund." }, { status: 400 });
  if (!reason) return NextResponse.json({ error: "Say why this refund is being made." }, { status: 400 });
  if (!method) return NextResponse.json({ error: "Choose card or bank transfer." }, { status: 400 });
  if (!requestId) return NextResponse.json({ error: "Missing request_id" }, { status: 400 });

  // Mesmo clique duas vezes: a segunda chamada acha a marca e não faz nada.
  const marker = `req ${requestId}`;
  const { data: dup } = await admin.from("job_payments").select("id").eq("job_id", job.id).ilike("note", `%${marker}%`).limit(1);
  if ((dup ?? []).length > 0) return NextResponse.json({ ok: true, repeated: true });

  const rows = await loadLedger(admin, job.id);
  const paid = customerNetPaid(rows).total;
  const split = splitRefundAcrossLedger(rows, amount);
  if (split.length === 0) {
    return NextResponse.json({ error: `The customer has paid £${paid.toFixed(2)} on this job. The refund cannot be more than that.` }, { status: 400 });
  }
  const inv = await loadInvoice(admin, job);

  let plan: { paymentIntent: string; pence: number }[] = [];
  let stripe: Stripe | null = null;
  if (method === "stripe") {
    try {
      stripe = requireStripe();
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Stripe is not configured." }, { status: 503 });
    }
    const charges = await loadCardCharges(stripe, rows, inv?.stripe_payment_intent_id ?? null);
    const planned = planCardRefunds(charges, Math.round(amount * 100));
    if (!planned) {
      const can = charges.reduce((s, c) => s + c.refundablePence, 0) / 100;
      return NextResponse.json({ error: `Only £${can.toFixed(2)} of this job was paid by card and can go back to the card. Refund the rest by bank transfer.` }, { status: 400 });
    }
    plan = planned;
  }

  const today = new Date().toISOString().split("T")[0];
  const baseNote = refundNote({ method, reason, invoiceRef: inv?.reference ?? null });
  const { data: inserted, error: insErr } = await admin
    .from("job_payments")
    .insert(split.map((s) => ({ job_id: job.id, type: s.type, amount: -s.amount, payment_date: today, payment_method: method, note: `${baseNote} · ${marker}`, created_by: auth.user.id })))
    .select("id");
  if (insErr) {
    const blocked = insErr.code === "23514";
    return NextResponse.json(
      { error: blocked ? "The database does not accept a negative payment yet. Run migration 324 and try again. No money was moved." : `Could not record the refund: ${insErr.message}. No money was moved.` },
      { status: blocked ? 409 : 500 },
    );
  }
  const ids = ((inserted ?? []) as { id: string }[]).map((r) => r.id);

  const refundIds: string[] = [];
  if (stripe) {
    try {
      for (const p of plan) {
        const r = await stripe.refunds.create(
          { payment_intent: p.paymentIntent, amount: p.pence, reason: "requested_by_customer", metadata: { job_reference: job.reference, os_request_id: requestId } },
          { idempotencyKey: `os-refund-${requestId}-${p.paymentIntent}` },
        );
        refundIds.push(r.id);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Stripe refused the refund.";
      if (refundIds.length === 0) {
        await admin.from("job_payments").update({ deleted_at: new Date().toISOString() }).in("id", ids);
        return NextResponse.json({ error: `Stripe did not refund: ${msg} Nothing was recorded.` }, { status: 502 });
      }
      // Parte já voltou para o cartão: o registro fica e alguém confere na Stripe.
      await admin.from("job_payments").update({ note: `${baseNote} · PARTIAL ON STRIPE, CHECK ${refundIds.join(" ")} · ${marker}` }).in("id", ids);
      await afterLedgerChange(admin, job.id);
      return NextResponse.json({ error: `Stripe refunded only part of it (${refundIds.join(", ")}) and then failed: ${msg} Check this job on Stripe.` }, { status: 502 });
    }
    await admin
      .from("job_payments")
      .update({ note: `${refundNote({ method, reason, invoiceRef: inv?.reference ?? null, stripeRefundId: refundIds.join(" ") })} · ${marker}` })
      .in("id", ids);
  }

  await afterLedgerChange(admin, job.id);

  const { data: profile } = await admin.from("profiles").select("full_name").eq("id", auth.user.id).maybeSingle();
  const { error: auditErr } = await admin.from("audit_logs").insert({
    entity_type: "job",
    entity_id: job.id,
    entity_ref: job.reference,
    action: "bulk_update",
    field_name: "customer_refund",
    new_value: String(amount),
    user_id: auth.user.id,
    user_name: (profile as { full_name?: string | null } | null)?.full_name?.trim() || auth.user.email || "User",
    metadata: { amount, method, reason, stripe_refund_ids: refundIds, invoice: inv?.reference ?? null },
  });
  if (auditErr) console.warn("[job-refund] audit não gravado:", auditErr.message);

  /**
   * Depois do refund (dono, 16/10/2026): o job vai para Cancelled (padrão; a equipe desmarca
   * num refund parcial de cortesia em que o job continua) e o cliente recebe o e-mail do
   * reembolso (padrão; desmarcável). Cada passo falha sozinho: o dinheiro já voltou.
   */
  let cancelado = false;
  if (body.cancel_job !== false) {
    try {
      const { cancelJobAfterRefund } = await import("@/lib/office-job-cancel-from-zendesk");
      const r = await cancelJobAfterRefund(admin, job.id, { reason, userId: auth.user.id });
      cancelado = r.ok;
      if (!r.ok) console.error("[job-refund] cancelar job:", r.error);
    } catch (e) {
      console.error("[job-refund] cancelar job:", e);
    }
  }
  let emailEnviado: string | null = null;
  if (body.notify_client !== false) {
    try {
      emailEnviado = await avisarClienteDoReembolso(admin, job.id, { amount, method });
    } catch (e) {
      console.error("[job-refund] e-mail ao cliente:", e);
    }
  }

  return NextResponse.json({ ok: true, amount, method, stripeRefundIds: refundIds, cancelled: cancelado, emailedTo: emailEnviado });
}

async function afterLedgerChange(admin: SupabaseClient, jobId: string) {
  await reconcileJobCustomerPaymentFlags(admin, jobId);
  await syncInvoicesFromJobCustomerPayments(admin, jobId);
  await syncInvoiceCollectionStagesForJob(admin, jobId).catch(() => {});
}

/** E-mail do reembolso ao cliente e nota no ticket. Devolve para quem foi, ou null. */
async function avisarClienteDoReembolso(
  admin: SupabaseClient,
  jobId: string,
  a: { amount: number; method: "stripe" | "bank_transfer" },
): Promise<string | null> {
  const { data: j } = await admin
    .from("jobs")
    .select("reference, title, client_id, client_name, external_source, external_ref")
    .eq("id", jobId)
    .maybeSingle();
  const job = j as { reference: string; title: string | null; client_id: string | null; client_name: string | null; external_source: string | null; external_ref: string | null } | null;
  if (!job?.client_id) return null;
  const { resolveNominalBillingParty } = await import("@/lib/account-billing-addressee");
  const parte = await resolveNominalBillingParty(admin, { clientId: job.client_id, fallbackName: job.client_name ?? undefined });
  const para = parte.documentEmail?.trim() ?? "";
  if (!para.includes("@")) return null;
  const { data: c } = await admin.from("clients").select("full_name, card_last4").eq("id", job.client_id).maybeSingle();
  const cliente = c as { full_name?: string | null; card_last4?: string | null } | null;
  const { enviarEmailDeReembolso } = await import("@/lib/emails/refund-client");
  await enviarEmailDeReembolso(para, {
    primeiroNome: cliente?.full_name ?? job.client_name,
    referenciaDoJob: job.reference,
    tituloDoJob: job.title,
    valor: a.amount,
    metodo: a.method,
    finalDoCartao: a.method === "stripe" ? cliente?.card_last4 ?? null : null,
  });
  if (job.external_source === "zendesk" && job.external_ref) {
    const { updateTicket } = await import("@/lib/zendesk");
    await updateTicket({
      ticketId: job.external_ref,
      publicComment: false,
      commentBody: `Refund of £${a.amount.toFixed(2)} (${a.method === "stripe" ? "back to the card" : "bank transfer"}) on ${job.reference}. Refund email sent to ${para}.`,
    }).catch((e: unknown) => console.error("[job-refund] nota no ticket:", e));
  }
  return para;
}
