import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getCompanySettings } from "@/services/company";
import { putJobOnHoldFromZendesk } from "@/lib/job-on-hold-from-zendesk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/holds
 *
 * Inbound webhook from Zendesk when an agent puts a ticket on hold.
 * Configure trigger on tag `on_hold` (+ idempotency tag e.g. `sent-hold-os`).
 *
 * Auth: `x-api-key` = `ZENDESK_WEBHOOK_API_KEY`
 *
 * Body:
 *   ticket_id: string (required)
 *   on_hold_reason_id: string (bare id or hold_* tag)
 *   on_hold_notes?: string (complaint detail; required when reason = complaint)
 */
export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-api-key");
  const expected = (process.env.ZENDESK_WEBHOOK_API_KEY ?? process.env.ZOHO_DESK_WEBHOOK_API_KEY)?.trim();
  if (!expected) {
    console.error("[api/holds] ZENDESK_WEBHOOK_API_KEY not configured");
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
  const onHoldReasonId =
    str(body.on_hold_reason_id)
    || str(body.on_hold_reason_preset_id)
    || str(body.reason);

  if (!ticketId) {
    return NextResponse.json({ error: "ticket_id is required." }, { status: 400 });
  }

  const companySettings = await getCompanySettings().catch(() => null);
  const result = await putJobOnHoldFromZendesk(
    {
      ticketId,
      onHoldReasonId: onHoldReasonId || "complaint",
      onHoldNotes:
        str(body.on_hold_notes)
        || str(body.description)
        || str(body.complaint_description)
        || null,
    },
    { setup: companySettings?.frontend_setup ?? null },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    id: result.jobId,
    reference: result.reference,
    status: "on_hold",
    action: result.action,
    on_hold_reason_id: result.onHoldReasonId,
    on_hold_reason_label: result.onHoldReasonLabel,
    previous_status: result.previousStatus,
    zendesk_status_sync: result.zendeskStatusSync,
    zendesk_fields_sync: result.zendeskFieldsSync,
    notify: result.notify,
  });
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v != null ? String(v).trim() : "";
}

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
