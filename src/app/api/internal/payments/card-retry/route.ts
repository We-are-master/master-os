/**
 * Novas tentativas de cobrança no cartão salvo (Fase 0, dono 09/10/2026): jobs em
 * final check com "Card refused" cuja próxima tentativa já venceu (1, 3 e 7 dias, só
 * nas recusas que a bandeira permite). Passou: lança no ledger e avisa a equipe pra
 * terminar o final review. Chamado pelo n8n de hora em hora.
 *
 * Auth: x-internal-secret = INTERNAL_SYNC_SECRET. ?dry-run=1 só lista.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { chargeJobBalanceOnSavedCard, CARD_ON_FILE_ON } from "@/lib/stripe-card-charge";
import { getZendeskTicketId, isZendeskConfigured, zendeskApi } from "@/lib/zendesk";

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
    .eq("status", "final_check")
    .not("card_retry_at", "is", null)
    .lte("card_retry_at", new Date().toISOString())
    .limit(25);

  const out: string[] = [];
  for (const job of due ?? []) {
    if (ensaio) { out.push(`${job.reference}: would retry`); continue; }
    const r = await chargeJobBalanceOnSavedCard(admin, job.id, { isRetry: true });
    out.push(`${job.reference}: ${r.status}`);
    const ticketId = getZendeskTicketId(job);
    if (!ticketId || !isZendeskConfigured()) continue;
    const texto =
      r.status === "charged"
        ? `💳 Card retry worked: £${r.amountGbp.toFixed(2)} charged. Please finish the final review to close the job.`
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
