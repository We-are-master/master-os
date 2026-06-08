import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getCompanySettings } from "@/services/company";
import { putJobOnHoldFromZendesk } from "@/lib/job-on-hold-from-zendesk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/webhooks/desk/job-on-hold
 *
 * Legacy path — same handler as POST /api/holds.
 */
export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-api-key");
  const expected = (process.env.ZENDESK_WEBHOOK_API_KEY ?? process.env.ZOHO_DESK_WEBHOOK_API_KEY)?.trim();
  if (!expected) {
    console.error("[webhook/desk/job-on-hold] ZENDESK_WEBHOOK_API_KEY not configured");
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
  if (!ticketId) {
    return NextResponse.json({ error: "ticket_id is required." }, { status: 400 });
  }

  const companySettings = await getCompanySettings().catch(() => null);
  const result = await putJobOnHoldFromZendesk(
    {
      ticketId,
      onHoldReasonId:
        str(body.on_hold_reason_id)
        || str(body.on_hold_reason_preset_id)
        || str(body.reason)
        || "complaint",
      onHoldNotes: str(body.description) || str(body.complaint_description) || str(body.on_hold_notes) || null,
    },
    { setup: companySettings?.frontend_setup ?? null },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    action: result.action,
    jobId: result.jobId,
    reference: result.reference,
    previousStatus: result.previousStatus,
    onHoldReasonId: result.onHoldReasonId,
    onHoldReasonLabel: result.onHoldReasonLabel,
    zendeskStatusSync: result.zendeskStatusSync,
    zendeskFieldsSync: result.zendeskFieldsSync,
    notify: result.notify,
  });
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
