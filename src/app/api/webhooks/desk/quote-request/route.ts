import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { partnerMatchesTypeOfWork } from "@/lib/partner-type-of-work-match";
import type { Partner } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * POST /api/webhooks/desk/quote-request
 *
 * Inbound webhook from Zoho Desk. Creates a quote in Master OS.
 *
 * quote_mode:
 *   "bid"    → status = bidding, push-notify matching partners to submit bids
 *   "manual" → status = draft, stays in office for manual pricing
 *   omitted  → defaults to "draft"
 *
 * Expected JSON body:
 *   {
 *     ticket_id:        string (required — idempotency key)
 *     title:            string (required)
 *     client_name:      string (required)
 *     client_email:     string (required)
 *     property_address: string
 *     service_type:     string (required)
 *     description:      string
 *     scope:            string
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

  const ticketId        = str(body.ticket_id);
  const title           = str(body.title);
  const clientName      = str(body.client_name);
  const clientEmail     = str(body.client_email).toLowerCase();
  const propertyAddress = str(body.property_address);
  const serviceType     = str(body.service_type);
  const description     = str(body.description);
  const scope           = str(body.scope);
  const totalValue      = num(body.total_value);
  const depositPercent  = Math.min(100, Math.max(0, num(body.deposit_percent)));
  const quoteMode       = str(body.quote_mode).toLowerCase() || "manual";

  if (!ticketId) {
    return NextResponse.json({ error: "ticket_id is required." }, { status: 400 });
  }
  if (!title || !clientName || !clientEmail || !serviceType) {
    return NextResponse.json(
      { error: "title, client_name, client_email and service_type are required." },
      { status: 400 },
    );
  }
  if (!scope) {
    return NextResponse.json({ error: "scope is required." }, { status: 400 });
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

  // ─── Find matching partners for bid mode ────────────────────────────
  let matchedPartnerIds: string[] = [];

  if (quoteMode === "bid") {
    const { data: activePartners } = await supabase
      .from("partners")
      .select("id, trade, trades, company_name, contact_name, expo_push_token, auth_user_id, uk_coverage_regions")
      .eq("status", "active");

    if (activePartners) {
      const matched = (activePartners as unknown as Partner[]).filter((p) =>
        partnerMatchesTypeOfWork(p, serviceType)
      );
      matchedPartnerIds = matched.map((p) => p.id);
    }
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
    title,
    client_id: clientId,
    client_name: clientName,
    client_email: clientEmail,
    property_address: propertyAddress || null,
    service_type: serviceType,
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
    scope,
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

  // ─── Push-notify partners for bid mode ─────────────────────────────
  let pushSent = 0;

  if (quoteMode === "bid" && matchedPartnerIds.length > 0) {
    pushSent = await sendPushToPartners(supabase, matchedPartnerIds, {
      title: "New quote — bid invitation",
      body: `${quoteRef} · ${title} · ${propertyAddress || serviceType}`,
      data: { type: "quote_bid_invite", quoteId },
    });
  }

  return NextResponse.json({
    ok: true,
    quoteId,
    reference: quoteRef,
    status,
    action: "created",
    partnersInvited: quoteMode === "bid" ? matchedPartnerIds.length : 0,
    pushSent,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────

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

async function sendPushToPartners(
  supabase: ReturnType<typeof createServiceClient>,
  partnerIds: string[],
  notification: { title: string; body: string; data: Record<string, unknown> },
): Promise<number> {
  if (!partnerIds.length) return 0;

  const { data: partners } = await supabase
    .from("partners")
    .select("id, expo_push_token, auth_user_id")
    .in("id", partnerIds)
    .eq("status", "active");

  const tokens: string[] = [];
  const missingAuthIds: string[] = [];

  for (const p of (partners ?? []) as { expo_push_token: string | null; auth_user_id: string | null }[]) {
    if (p.expo_push_token) {
      tokens.push(p.expo_push_token);
    } else if (p.auth_user_id) {
      missingAuthIds.push(p.auth_user_id);
    }
  }

  if (missingAuthIds.length > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("id, fcmToken")
      .in("id", missingAuthIds)
      .not("fcmToken", "is", null);
    for (const u of (users ?? []) as { fcmToken: string | null }[]) {
      if (u.fcmToken) tokens.push(u.fcmToken);
    }
  }

  if (!tokens.length) return 0;

  try {
    const messages = tokens.map((to) => ({
      to,
      title: notification.title,
      body: notification.body.slice(0, 500),
      data: notification.data,
      sound: "default" as const,
    }));
    await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    return tokens.length;
  } catch (err) {
    console.error("[webhook/desk/quote] push failed:", err);
    return 0;
  }
}
