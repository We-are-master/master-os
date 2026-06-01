import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeTypeOfWork } from "@/lib/type-of-work";
import {
  dispatchQuoteBidInvites,
  resolveQuoteCatalogServiceId,
} from "@/lib/quote-bid-invites";
import { matchPartnerIdsForWork } from "@/lib/partner-work-matching";
import { extractUkPostcode } from "@/lib/uk-postcode";
import { resolveDeskWebhookClientEmail } from "@/lib/desk-webhook-client-email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/webhooks/desk/quote-request
 *
 * Inbound webhook from Zoho Desk. Creates a quote in Master OS.
 *
 * quote_mode:
 *   "bid"    → status = bidding, notify matching partners (email + portal + app)
 *   "manual" → status = draft, stays in office for manual pricing
 *   omitted  → defaults to "draft"
 *
 * Expected JSON body:
 *   {
 *     ticket_id:        string (required — idempotency key)
 *     client_name:      string (required)
 *     client_email:     string (required)
 *     property_address: string
 *     service_type:     string (required) — canonical trade; becomes quote.title (+ matching)
 *     description:      string (optional; used as scope only if scope is empty)
 *     scope:            string (optional — free-text brief; omit if none)
 *     total_value:      number
 *     deposit_percent:  number (0-100)
 *     quote_mode:       "bid" | "manual"
 *   }
 */
export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-api-key");
  const expected = (process.env.ZENDESK_WEBHOOK_API_KEY ?? process.env.ZOHO_DESK_WEBHOOK_API_KEY)?.trim();
  if (!expected) {
    console.error("[webhook/desk/quote] ZOHO_DESK_WEBHOOK_API_KEY not configured");
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

  const ticketId = str(body.ticket_id);
  const clientName = str(body.client_name);
  const clientEmail = resolveDeskWebhookClientEmail(body.client_email);
  const propertyAddress = str(body.property_address);
  const serviceType = str(body.service_type);
  const description = str(body.description);
  const scopePrimary = str(body.scope);

  const normalizedServiceType = normalizeTypeOfWork(serviceType).trim() || serviceType.trim();

  /** Desk may still send legacy `title` (ticket subject — ignored for storage). */
  const canonicalTitle = normalizedServiceType || "(No type)";
  const scopeCombinedTrim = scopePrimary || description;
  const scopeOut = scopeCombinedTrim.trim() ? scopeCombinedTrim : null;
  const totalValue = num(body.total_value);
  const depositPercent = Math.min(100, Math.max(0, num(body.deposit_percent)));
  const quoteMode = str(body.quote_mode).toLowerCase() || "manual";

  if (!ticketId) {
    return NextResponse.json({ error: "ticket_id is required." }, { status: 400 });
  }
  if (!clientName || !serviceType) {
    return NextResponse.json(
      { error: "client_name and service_type are required." },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();

  // ─── Idempotency ────────────────────────────────────────────────────
  const { data: existing } = await supabase
    .from("quotes")
    .select("id, reference")
    .eq("external_source", "zendesk")
    .eq("external_ref", ticketId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      ok: true,
      quoteId: (existing as { id: string }).id,
      reference: (existing as { reference: string }).reference,
      action: "already_exists",
    });
  }

  // ─── Resolve client ─────────────────────────────────────────────────
  let clientId: string | null = null;
  if (clientEmail) {
    const { data: clientRow } = await supabase
      .from("clients")
      .select("id")
      .eq("email", clientEmail)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (clientRow) {
      clientId = (clientRow as { id: string }).id;
    }
  }

  // ─── Match partners + catalog for bid mode ──────────────────────────
  let matchedPartnerIds: string[] = [];
  let catalogServiceId: string | null = null;

  if (quoteMode === "bid") {
    catalogServiceId = await resolveQuoteCatalogServiceId(supabase, normalizedServiceType);
    const postcode = extractUkPostcode(propertyAddress) ?? (propertyAddress || null);
    matchedPartnerIds = await matchPartnerIdsForWork(supabase, {
      serviceType: normalizedServiceType,
      catalogServiceId,
      postcode,
      kind: "lead",
    });
  }

  const status = quoteMode === "bid" && matchedPartnerIds.length > 0 ? "bidding" : "draft";
  const depositRequired = totalValue > 0 ? Math.round(totalValue * depositPercent) / 100 : 0;

  // ─── Generate reference + insert ───────────────────────────────────
  const { data: refData, error: refErr } = await supabase.rpc("next_quote_ref");
  if (refErr || !refData) {
    console.error("[webhook/desk/quote] next_quote_ref failed:", refErr);
    return NextResponse.json({ error: "Could not generate a quote reference." }, { status: 500 });
  }

  const quoteRow: Record<string, unknown> = {
    reference: String(refData),
    title: canonicalTitle,
    client_id: clientId,
    client_name: clientName,
    client_email: clientEmail,
    property_address: propertyAddress || null,
    service_type: normalizedServiceType,
    catalog_service_id: catalogServiceId,
    status,
    total_value: totalValue,
    cost: 0,
    sell_price: totalValue,
    margin_percent: 0,
    partner_cost: 0,
    partner_quotes_count: quoteMode === "bid" ? matchedPartnerIds.length : 0,
    quote_type: quoteMode === "bid" ? "partner" : "internal",
    deposit_percent: depositPercent,
    deposit_required: depositRequired,
    scope: scopeOut ?? "",
    customer_accepted: false,
    customer_deposit_paid: false,
    external_source: "zendesk",
    external_ref: ticketId,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("quotes")
    .insert(quoteRow)
    .select("id, reference, status")
    .single();

  if (insertErr || !inserted) {
    console.error("[webhook/desk/quote] insert failed:", insertErr);
    return NextResponse.json({ error: "Could not create the quote." }, { status: 500 });
  }

  const quoteId = (inserted as { id: string }).id;
  const quoteRef = (inserted as { reference: string }).reference;

  let dispatch = { partnerIds: [] as string[], pushSent: 0, emailsSent: 0, invitationsTracked: 0 };

  if (quoteMode === "bid" && matchedPartnerIds.length > 0) {
    try {
      dispatch = await dispatchQuoteBidInvites(supabase, {
        quoteId,
        quoteReference: quoteRef,
        title: canonicalTitle,
        serviceType: normalizedServiceType,
        propertyAddress,
        scope: scopeOut,
        partnerIds: matchedPartnerIds,
        catalogServiceId,
      });
    } catch (err) {
      console.error("[webhook/desk/quote] bid dispatch failed:", err);
    }
  }

  return NextResponse.json({
    ok: true,
    quoteId,
    reference: quoteRef,
    status,
    action: "created",
    partnersInvited: dispatch.partnerIds.length,
    pushSent: dispatch.pushSent,
    emailsSent: dispatch.emailsSent,
  });
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
