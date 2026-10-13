import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { mandarQuoteDaLigacao } from "@/lib/harvey-wa/ligacao-quote";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/webhooks/desk/call-quote-followup
 *
 * A equipe atendeu uma ligação de quem quer quote e apertou a macro
 * "Call: send quote WhatsApp" no ticket da ligação. Esta porta manda o template
 * pedindo fotos e postcode para o celular de quem ligou e deixa a nota no ticket.
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
  const expected = (process.env.ZENDESK_WEBHOOK_API_KEY ?? process.env.ZOHO_DESK_WEBHOOK_API_KEY)?.trim();
  if (!expected) {
    console.error("[webhook/call-quote-followup] ZENDESK_WEBHOOK_API_KEY not configured");
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }
  if (!secretsMatch(req.headers.get("x-api-key"), expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const ticketId = String(body.ticket_id ?? "").trim();
  if (!ticketId) return NextResponse.json({ error: "ticket_id is required." }, { status: 400 });

  try {
    const r = await mandarQuoteDaLigacao(ticketId);
    return NextResponse.json(r, { status: 200 });
  } catch (e) {
    console.error("[webhook/call-quote-followup]", e);
    return NextResponse.json({ error: "Failed." }, { status: 500 });
  }
}
