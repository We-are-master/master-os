/**
 * Novas tentativas de cobrança no cartão salvo (Fase 0, dono 09/10/2026): jobs com
 * "Card declined" (em final check ou, desde 14/10/2026, em Awaiting Payment) cuja
 * próxima tentativa já venceu (1, 3 e 7 dias, só nas recusas que a bandeira permite).
 * Passou: lança no ledger e o job em Awaiting Payment fecha sozinho. Já pago por outro
 * meio: o chip sai e as tentativas param. Chamado pelo n8n de hora em hora.
 *
 * Auth: x-internal-secret = INTERNAL_SYNC_SECRET. ?dry-run=1 só lista.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { chargeJobBalanceOnSavedCard, CARD_ON_FILE_ON } from "@/lib/stripe-card-charge";
import { getZendeskTicketId, isZendeskConfigured, zendeskApi } from "@/lib/zendesk";
import { finalizeJobAfterInvoicePaid } from "@/lib/sync-job-after-invoice-paid";

export const runtime = "nodejs";
export const maxDuration = 60;

function autorizado(dado: string | null): boolean {
  const segredo = process.env.INTERNAL_SYNC_SECRET?.trim();
  if (!segredo || !dado || dado.length !== segredo.length) return false;
  return timingSafeEqual(Buffer.from(dado), Buffer.from(segredo));
}

export async function POST(req: NextRequest) {
  if (!autorizado(req.headers.get("x-internal-secret"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!CARD_ON_FILE_ON()) return NextResponse.json({ ok: true, off: true });
  const ensaio = req.nextUrl.searchParams.get("dry-run") === "1";

  const admin = createServiceClient();
  const { data: due } = await admin
    .from("jobs")
    .select("id, reference, external_source, external_ref")
    .eq("card_charge_status", "refused")
    .in("status", ["final_check", "awaiting_payment"])
    .not("card_retry_at", "is", null)
    .lte("card_retry_at", new Date().toISOString())
    .limit(25);

  const out: string[] = [];
  for (const job of due ?? []) {
    if (ensaio) { out.push(`${job.reference}: would retry`); continue; }
    const r = await chargeJobBalanceOnSavedCard(admin, job.id, { isRetry: true });
    out.push(`${job.reference}: ${r.status}`);
    if (r.status === "charged") {
      // Fatura e status do job acompanham o pagamento (Awaiting Payment → Completed).
      await finalizeJobAfterInvoicePaid(admin, job.id).catch((e) => console.error("[card-retry] finalize", e));
    }
    if (r.status === "skipped" && r.reason === "Nothing left to pay") {
      // Pago por outro meio: para de tentar e tira o chip.
      await admin.from("jobs").update({ card_charge_status: "skipped", card_retry_at: null }).eq("id", job.id);
      continue;
    }
    const ticketId = getZendeskTicketId(job);
    if (!ticketId || !isZendeskConfigured()) continue;
    const texto =
      r.status === "charged"
        ? `💳 Card retry worked: £${r.amountGbp.toFixed(2)} charged.`
        : r.status === "refused"
          ? `💳 Card retry refused again: ${r.reason}. ${r.retryAt ? `Next try ${new Date(r.retryAt).toLocaleDateString("en-GB", { timeZone: "Europe/London" })}.` : "No more automatic tries: please follow up with the customer."}`
          : r.status === "requires_action"
            ? `💳 Card retry needs the customer to confirm with their bank: send them the payment link.`
            : null;
    if (texto) {
      await zendeskApi(`tickets/${ticketId}.json`, {
        method: "PUT",
        body: { ticket: { comment: { public: false, body: texto } } },
      }).catch((e) => console.error("[card-retry] note failed", e));
    }
  }
  return NextResponse.json({ ok: true, ensaio, results: out });
}
