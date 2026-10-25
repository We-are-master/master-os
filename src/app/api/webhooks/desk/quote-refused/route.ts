import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { recusarQuoteDoTicket } from "@/lib/quote-recusada-zendesk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/webhooks/desk/quote-refused
 *
 * Chamado pelo gatilho "Quote refused — Send to OS" do Zendesk quando a macro
 * "❌ Quote refused" é aplicada. Corpo: { ticket_id, reason? }.
 * A regra mora em `lib/quote-recusada-zendesk.ts`.
 */
export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-api-key");
  const expected = (process.env.ZENDESK_WEBHOOK_API_KEY ?? process.env.ZOHO_DESK_WEBHOOK_API_KEY)?.trim();
  if (!expected) {
    console.error("[webhook/desk/quote-refused] ZENDESK_WEBHOOK_API_KEY not configured");
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

  const result = await recusarQuoteDoTicket(createServiceClient(), {
    ticketId: String(body.ticket_id ?? "").trim(),
    motivo: typeof body.reason === "string" ? body.reason : null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
