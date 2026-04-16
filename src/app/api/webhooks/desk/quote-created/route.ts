import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

/**
 * POST /api/webhooks/desk/quote-created
 *
 * Inbound webhook from Zoho Desk. Each Desk ticket gets mirrored as a
 * service_requests row with source = "zoho_desk" and external_ref = ticket id
 * so re-deliveries upsert instead of duplicating.
 *
 * Auth: header `X-API-Key` must match env `ZOHO_DESK_WEBHOOK_API_KEY`.
 *
 * Expected JSON body (from Deluge `Send Quote to OS`):
 *   {
 *     ticket_id:        string,
 *     account_name:     string,
 *     property_address: string,
 *     type_of_work:     string,
 *     urgency:          string,   // Low | Medium | High | Urgent
 *     notes:            string,
 *     client_email:     string
 *   }
 */
export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-api-key");
  const expected = process.env.ZOHO_DESK_WEBHOOK_API_KEY?.trim();
  if (!expected) {
    console.error("[webhook/desk] ZOHO_DESK_WEBHOOK_API_KEY not configured");
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }
  if (!secretsMatch(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const ticketId        = str(body.ticket_id);
  const accountName     = str(body.account_name);
  const propertyAddress = str(body.property_address);
  const typeOfWork      = str(body.type_of_work);
  const urgency         = str(body.urgency);
  const notes           = str(body.notes);
  const clientEmail     = str(body.client_email).toLowerCase();

  if (!ticketId) {
    return NextResponse.json({ error: "ticket_id is required." }, { status: 400 });
  }
  if (!accountName || !propertyAddress || !typeOfWork || !clientEmail) {
    return NextResponse.json(
      { error: "account_name, property_address, type_of_work and client_email are required." },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();

  // Idempotency: if Desk re-fires the same ticket, update the existing row.
  const { data: existing } = await supabase
    .from("service_requests")
    .select("id, reference")
    .eq("external_source", "zoho_desk")
    .eq("external_ref", ticketId)
    .maybeSingle();

  const priority = mapUrgency(urgency);

  if (existing) {
    const id = (existing as { id: string }).id;
    const { error: updateErr } = await supabase
      .from("service_requests")
      .update({
        client_name:      accountName,
        client_email:     clientEmail,
        property_address: propertyAddress,
        service_type:     typeOfWork,
        description:      notes || `Imported from Zoho Desk ticket ${ticketId}`,
        priority,
        notes:            notes || null,
      })
      .eq("id", id);
    if (updateErr) {
      console.error("[webhook/desk] update failed:", updateErr);
      return NextResponse.json({ error: "Could not update the request." }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      requestId: id,
      reference: (existing as { reference: string }).reference,
      action: "updated",
    });
  }

  const { data: refData, error: refErr } = await supabase.rpc("next_request_ref");
  if (refErr || !refData) {
    console.error("[webhook/desk] next_request_ref failed:", refErr);
    return NextResponse.json({ error: "Could not generate a request reference." }, { status: 500 });
  }
  const reference = String(refData);

  const { data: inserted, error: insertErr } = await supabase
    .from("service_requests")
    .insert({
      reference,
      client_name:      accountName,
      client_email:     clientEmail,
      property_address: propertyAddress,
      service_type:     typeOfWork,
      description:      notes || `Imported from Zoho Desk ticket ${ticketId}`,
      status:           "new",
      priority,
      source:           "zoho_desk",
      notes:            notes || null,
      external_source:  "zoho_desk",
      external_ref:     ticketId,
    })
    .select("id, reference")
    .single();

  if (insertErr || !inserted) {
    console.error("[webhook/desk] insert failed:", insertErr);
    return NextResponse.json({ error: "Could not create the request." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    requestId: (inserted as { id: string }).id,
    reference: (inserted as { reference: string }).reference,
    action: "created",
  });
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function mapUrgency(raw: string): "low" | "medium" | "high" | "urgent" {
  switch (raw.toLowerCase()) {
    case "low":    return "low";
    case "high":   return "high";
    case "urgent": return "urgent";
    default:       return "medium";
  }
}

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
