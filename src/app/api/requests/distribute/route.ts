import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { matchPartnerIdsForWork } from "@/lib/partner-work-matching";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/requests/distribute  { requestId, partnerIds? }
 *
 * Distributes a service_request (lead) to partners: inserts rows into
 * service_request_partner_offers, which the Fixfy Trade Portal reads under "Leads".
 * If partnerIds is omitted, auto-matches active partners by trade + lead opt-in +
 * excluded postcodes (matchPartnerIdsForWork). Idempotent on (service_request_id, partner_id).
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
    if (!requestId || !isValidUUID(requestId)) {
      return NextResponse.json({ error: "requestId is required" }, { status: 400 });
    }
    const explicit = Array.isArray(body.partnerIds)
      ? (body.partnerIds as unknown[]).filter((x): x is string => typeof x === "string" && isValidUUID(x.trim()))
      : null;

    const supabase = createServiceClient();
    const { data: sr, error: srErr } = await supabase
      .from("service_requests")
      .select("id, service_type, catalog_service_id, postcode, priority")
      .eq("id", requestId)
      .single();
    if (srErr || !sr) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    let partnerIds = explicit && explicit.length > 0 ? explicit : null;
    if (!partnerIds) {
      partnerIds = await matchPartnerIdsForWork(supabase, {
        serviceType: sr.service_type,
        catalogServiceId: sr.catalog_service_id,
        postcode: sr.postcode,
        kind: "lead",
        emergency: sr.priority === "urgent",
      });
    }
    if (partnerIds.length === 0) {
      return NextResponse.json({ ok: true, offered: 0, reason: "No matching partners" });
    }

    const nowIso = new Date().toISOString();
    const rows = partnerIds.map((pid) => ({
      service_request_id: requestId,
      partner_id: pid,
      status: "offered",
      offered_at: nowIso,
      last_channel: "system",
    }));
    const { error: upErr } = await supabase
      .from("service_request_partner_offers")
      .upsert(rows, { onConflict: "service_request_id,partner_id" });
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, offered: partnerIds.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
