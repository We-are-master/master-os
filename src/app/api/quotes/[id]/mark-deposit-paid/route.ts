import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncJobAfterInvoicePaidToLedger } from "@/lib/sync-job-after-invoice-paid";
import { aposEntradaDaCotacaoPaga } from "@/lib/quote-deposit-paid-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * POST /api/quotes/[id]/mark-deposit-paid  { amount? }
 *
 * "Mark as paid" da cotação aceita pelo link (16/10/2026). Desde a #800 o aceite já cria o
 * job e a fatura de entrada (em rascunho); o botão abria o "criar job" e gerava um job
 * duplicado, e o Billing não marca rascunho como pago. Aqui a entrada do job que já existe
 * vira paga e roda a mesma rotina do Stripe (recibo, parceiro do lance, Job confirmed).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!ALLOWED_ROLES.has((profile as { role?: string } | null)?.role ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: quoteId } = await ctx.params;
  if (!isValidUUID(quoteId)) return NextResponse.json({ error: "Invalid quote id" }, { status: 400 });
  let body: { amount?: number } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* corpo opcional */
  }

  const supabase = createServiceClient();
  const { data: quote } = await supabase.from("quotes").select("id, reference, status").eq("id", quoteId).maybeSingle();
  if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  if ((quote as { status?: string }).status !== "awaiting_payment") {
    return NextResponse.json({ error: "Quote is not awaiting payment" }, { status: 409 });
  }

  const { data: job } = await supabase
    .from("jobs")
    .select("id, reference")
    .eq("quote_id", quoteId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const j = job as { id: string; reference: string } | null;
  if (!j) return NextResponse.json({ error: "no_job", message: "This quote has no job yet" }, { status: 404 });

  const { data: inv } = await supabase
    .from("invoices")
    .select("id, reference, amount, status")
    .eq("job_reference", j.reference)
    .eq("invoice_kind", "deposit")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const fatura = inv as { id: string; reference: string; amount: number; status: string } | null;
  if (!fatura) return NextResponse.json({ error: "Deposit invoice not found" }, { status: 404 });

  const valorDaFatura = Math.round((Number(fatura.amount) || 0) * 100) / 100;
  const pedido = Number(body.amount);
  const valor = Number.isFinite(pedido) && pedido > 0 ? Math.round(Math.min(pedido, valorDaFatura) * 100) / 100 : valorDaFatura;

  if (fatura.status !== "paid") {
    const hoje = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from("invoices")
      .update({ status: "paid", amount_paid: valor, paid_date: hoje, collection_stage: "completed" })
      .eq("id", fatura.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await syncJobAfterInvoicePaidToLedger(supabase, fatura.id, "Manual");
  }

  const agiu = await aposEntradaDaCotacaoPaga(supabase, j.reference, "quote_mark_as_paid");
  await supabase.from("audit_logs").insert({
    entity_type: "invoice",
    entity_id: fatura.id,
    entity_ref: fatura.reference,
    action: "status_changed",
    field_name: "status",
    old_value: fatura.status,
    new_value: "paid",
    user_id: auth.user.id,
    metadata: { source: "quote_mark_as_paid", quote_id: quoteId, amount: valor },
  });
  return NextResponse.json({ ok: true, jobId: j.id, jobReference: j.reference, invoice: fatura.reference, amount: valor, agiu });
}
