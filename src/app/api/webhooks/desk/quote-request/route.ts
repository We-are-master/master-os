import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeTypeOfWork } from "@/lib/type-of-work";
import { resolveQuoteCatalogServiceId } from "@/lib/quote-bid-invites";
import { resolveDeskWebhookClientEmail } from "@/lib/desk-webhook-client-email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/webhooks/desk/quote-request
 *
 * Inbound webhook from Zoho Desk. Creates a quote in Master OS.
 *
 * quote_mode:
 *   "bid"    → status = draft, quote_type = partner (Quotes → New).
 *              Office starts bidding from the UI; partners invited then.
 *   "manual" → status = draft, quote_type = internal
 *   omitted  → defaults to "manual"/draft
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

  // Bid mode lands in New as a partner draft — invites fire when office Starts Bidding.
  let catalogServiceId: string | null = null;
  if (quoteMode === "bid") {
    catalogServiceId = await resolveQuoteCatalogServiceId(supabase, normalizedServiceType);
  }

  const status = "draft";
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
    partner_quotes_count: 0,
    quote_type: quoteMode === "bid" ? "partner" : "internal",
    deposit_percent: depositPercent,
    deposit_required: depositRequired,
    scope: scopeOut ?? "",
    customer_accepted: false,
    customer_deposit_paid: false,
    // draft_route_completed saiu: a coluna não existe no banco vivo e o
    // PostgREST rejeita o insert inteiro por causa dela.
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

  return NextResponse.json({
    ok: true,
    quoteId,
    reference: quoteRef,
    status,
    quote_type: quoteMode === "bid" ? "partner" : "internal",
    action: "created",
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
