import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { cancelJobFromZendeskWebhook } from "@/lib/office-job-cancel-from-zendesk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/cancellations
 *
 * Inbound webhook from Zendesk when an agent applies "Mark as Cancelled".
 * Configure trigger → notify webhook with ticket custom fields (strip `cancel_`
 * prefix in Liquid or send raw tag — OS accepts both).
 *
 * Auth: `x-api-key` = `ZENDESK_WEBHOOK_API_KEY` (or `ZOHO_DESK_WEBHOOK_API_KEY`).
 *
 * Body:
 *   ticket_id: string (required)
 *   cancellation_reason_id: string (bare OS id or cancel_* tag)
 *   cancellation_notes?: string (required when reason is other)
 *   lost_value_gbp: number (required — agent-reported lost revenue in GBP)
 *   cancelled_by_agent?: string
 *   cancelled_at?: ISO8601 string
 */
export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-api-key");
  const expected = (process.env.ZENDESK_WEBHOOK_API_KEY ?? process.env.ZOHO_DESK_WEBHOOK_API_KEY)?.trim();
  if (!expected) {
    console.error("[api/cancellations] ZENDESK_WEBHOOK_API_KEY not configured");
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

  const ticketId = str(body.ticket_id);
  const cancellationReasonId =
    str(body.cancellation_reason_id)
    || str(body.cancellation_reason)
    || "";

  if (!ticketId) {
    return NextResponse.json({ error: "ticket_id is required." }, { status: 400 });
  }
  if (!cancellationReasonId) {
    return NextResponse.json({ error: "cancellation_reason_id is required." }, { status: 400 });
  }

  const lostValueGbp = parseLostValueGbp(body.lost_value_gbp);
  if (lostValueGbp == null) {
    return NextResponse.json({ error: "lost_value_gbp is required (number >= 0)." }, { status: 400 });
  }

  const result = await cancelJobFromZendeskWebhook({
    ticketId,
    cancellationReasonId,
    cancellationNotes: str(body.cancellation_notes) || null,
    lostValueGbp,
    cancelledByAgent: str(body.cancelled_by_agent) || null,
    cancelledAt: str(body.cancelled_at) || null,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const payload =
    result.action === "existing"
      ? { id: result.id, status: "cancelled", reference: result.reference, action: "existing" as const }
      : { id: result.id, status: "cancelled", reference: result.reference };

  return NextResponse.json(payload, { status: result.status });
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v != null ? String(v).trim() : "";
}

function parseLostValueGbp(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
