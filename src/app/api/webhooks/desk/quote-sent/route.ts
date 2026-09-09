import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { persistQuoteSentToCustomer } from "@/lib/quotes/persist-quote-sent-to-customer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/webhooks/desk/quote-sent
 *
 * O dono mandou a quote PELO ZENDESK e apertou a macro "Quote Sent".
 *
 * Existe porque o trabalho dele acontece na thread, não no OS: ele lê o
 * rascunho que o Harvey deixou na nota interna, responde o cliente ali mesmo, e
 * a macro é o "pronto, mandei". Sem esta porta o OS ficaria em `quote_ready`
 * para sempre enquanto o cliente já tem o preço, que é a mesma divergência que
 * fez a QT-2026-1139 ficar com £633,33 gravados contra £520 enviados.
 *
 * O botão "Send to customer" do OS continua existindo e faz mais: monta o PDF e
 * anexa. Esta porta é o caminho de quem escreveu o e-mail à mão, então ela não
 * inventa PDF nenhum. Ela só registra que o cliente recebeu.
 *
 * Auth: header `X-API-Key` = ZENDESK_WEBHOOK_API_KEY, igual às outras portas.
 * Body: { ticket_id: string }
 */
function secretsMatch(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-api-key");
  const expected = (process.env.ZENDESK_WEBHOOK_API_KEY ?? process.env.ZOHO_DESK_WEBHOOK_API_KEY)?.trim();
  if (!expected) {
    console.error("[webhook/quote-sent] ZENDESK_WEBHOOK_API_KEY not configured");
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }
  if (!secretsMatch(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const ticketId = String(body.ticket_id ?? "").trim();
  if (!ticketId) {
    return NextResponse.json({ error: "ticket_id is required." }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("quotes")
    .select("id, reference, status")
    .eq("external_source", "zendesk")
    .eq("external_ref", ticketId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[webhook/quote-sent] lookup failed:", error.message);
    return NextResponse.json({ error: "Lookup failed." }, { status: 500 });
  }
  const quote = (data ?? [])[0] as { id: string; reference: string; status: string } | undefined;
  if (!quote) {
    // 200 de propósito: o Zendesk não deve ficar reenviando por causa de um
    // ticket que nunca teve quote. O log conta a história.
    console.warn(`[webhook/quote-sent] ticket ${ticketId} has no quote in the OS`);
    return NextResponse.json({ ok: true, skipped: "no quote for this ticket" });
  }

  /**
   * Estado que já passou não volta.
   *
   * A macro pode ser clicada duas vezes, e o Zendesk reentrega webhook. Se a
   * quote já está em `awaiting_customer`, `awaiting_payment` ou virou job, o
   * certo é não fazer nada em vez de arrastá-la para trás.
   */
  const jaPassou = ["awaiting_customer", "awaiting_payment", "converted_to_job", "rejected"];
  if (jaPassou.includes(quote.status)) {
    return NextResponse.json({ ok: true, skipped: `already ${quote.status}`, quote: quote.reference });
  }

  const agora = new Date().toISOString();
  const r = await persistQuoteSentToCustomer(supabase, quote.id, agora);
  if (r.error) {
    console.error("[webhook/quote-sent] update failed:", r.error.message);
    return NextResponse.json({ error: "Could not update the quote." }, { status: 500 });
  }

  void supabase.from("audit_logs").insert({
    entity_type: "quote",
    entity_id: quote.id,
    entity_ref: quote.reference,
    action: "updated",
    field_name: "status",
    old_value: quote.status,
    new_value: "awaiting_customer",
    metadata: { source: "zendesk_macro", ticket_id: ticketId },
  }).then(({ error: e }) => { if (e) console.error("[webhook/quote-sent] audit failed:", e.message); });

  console.log(`[webhook/quote-sent] ${quote.reference}: ${quote.status} → awaiting_customer (ticket ${ticketId})`);
  return NextResponse.json({ ok: true, quote: quote.reference, from: quote.status, to: "awaiting_customer" });
}
