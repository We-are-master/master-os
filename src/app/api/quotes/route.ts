import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { isValidUUID } from "@/lib/auth-api";
import { safePostgrestEnumValue } from "@/lib/supabase/sanitize";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * POST /api/quotes
 *
 * Creates a draft quote from an external caller (n8n, integration scripts).
 * Auth: header `X-API-Key` must match env `MASTER_OS_QUOTE_WEBHOOK_API_KEY`.
 *
 * Body (JSON):
 *   {
 *     account_id:       uuid,                  // accounts.id — required
 *     date:             string,                // YYYY-MM-DD, DD-MM-YYYY, DD-MM-YY, DD/MM/YYYY, DD/MM/YY
 *     hour:             "HH:MM",               // required, 24h
 *     title:            string,                // required
 *     client_name:      string,                // required
 *     client_email:     string,                // required
 *     description?:     string,                // → quotes.scope
 *     service_type?:    string,                // trade label (Plumbing, Electrical, etc.)
 *     type_of_quoting?: "manual" | "bidding",  // default "manual" (case-insensitive)
 *     ticket_id?:       string                 // Zendesk ticket id — stored as
 *                                              //   external_source='zendesk',
 *                                              //   external_ref=ticket_id.
 *                                              //   Re-posting the same id returns
 *                                              //   the existing quote (idempotent).
 *   }
 *
 * Behavior:
 *   - Finds (or creates) a clients row in the given account matching
 *     client_email, then attaches the new quote to it. The account
 *     linkage flows through clients.source_account_id → accounts.id.
 *   - date + hour are combined into quotes.start_date_option_1 (ISO).
 *   - type_of_quoting='manual'  → status='draft', quote_type='internal'
 *   - type_of_quoting='bidding' → status='bidding', quote_type='partner',
 *     and active partners whose trades match service_type get an Expo
 *     push notification with the quote details. service_type is required
 *     in this mode (no trade = no one to invite).
 *
 * Response: 201 { id, reference, status, partners_notified? }
 */
export async function POST(req: NextRequest) {
  // ─── Auth ────────────────────────────────────────────────────────────
  const provided = req.headers.get("x-api-key");
  const expected = process.env.MASTER_OS_QUOTE_WEBHOOK_API_KEY?.trim();
  if (!expected) {
    console.error("[api/quotes] MASTER_OS_QUOTE_WEBHOOK_API_KEY not configured");
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }
  if (!secretsMatch(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // ─── Parse body ──────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const accountId       = str(body.account_id);
  const date            = str(body.date);
  const hour            = str(body.hour);
  const title           = str(body.title);
  const clientName      = str(body.client_name);
  const clientEmail     = str(body.client_email).toLowerCase();
  const description     = str(body.description) || null;
  const serviceType     = str(body.service_type) || null;
  const ticketId        = str(body.ticket_id) || null;
  const typeOfQuotingRaw = str(body.type_of_quoting) || "manual";
  // Accept "Manual"/"Bidding"/"manual"/"bidding"/etc. — regex-anchored,
  // case-insensitive. Normalised to lowercase for the rest of the route.
  if (!/^(manual|bidding)$/i.test(typeOfQuotingRaw)) {
    return NextResponse.json(
      { error: "type_of_quoting must be 'manual' or 'bidding' (case-insensitive)." },
      { status: 400 },
    );
  }
  const typeOfQuoting   = typeOfQuotingRaw.toLowerCase() as "manual" | "bidding";

  // ─── Validation ──────────────────────────────────────────────────────
  if (!accountId || !date || !hour || !title || !clientName || !clientEmail) {
    return NextResponse.json(
      { error: "account_id, date, hour, title, client_name, and client_email are required." },
      { status: 400 },
    );
  }
  if (typeOfQuoting === "bidding" && !serviceType) {
    return NextResponse.json(
      { error: "service_type is required when type_of_quoting is 'bidding' (used to match partners)." },
      { status: 400 },
    );
  }
  if (!isValidUUID(accountId)) {
    return NextResponse.json({ error: "account_id must be a valid UUID." }, { status: 400 });
  }
  const isoDate = normalizeDateToIso(date);
  if (!isoDate) {
    return NextResponse.json(
      { error: "date must be YYYY-MM-DD, DD-MM-YYYY, DD-MM-YY, DD/MM/YYYY, or DD/MM/YY." },
      { status: 400 },
    );
  }
  if (!/^\d{2}:\d{2}$/.test(hour)) {
    return NextResponse.json({ error: "hour must be HH:MM (24h)." }, { status: 400 });
  }
  if (!clientEmail.includes("@")) {
    return NextResponse.json({ error: "client_email must be a valid email." }, { status: 400 });
  }

  const startIso = combineDateHourToIso(isoDate, hour);
  if (!startIso) {
    return NextResponse.json({ error: "date + hour did not parse to a valid timestamp." }, { status: 400 });
  }

  // ─── DB ──────────────────────────────────────────────────────────────
  const supabase = createServiceClient();

  // Idempotency: if a Zendesk ticket id was supplied and we already have a
  // quote for it, return the existing row instead of duplicating.
  if (ticketId) {
    const { data: dup } = await supabase
      .from("quotes")
      .select("id, reference, status")
      .eq("external_source", "zendesk")
      .eq("external_ref", ticketId)
      .maybeSingle();
    if (dup) {
      return NextResponse.json(
        { id: dup.id, reference: dup.reference, status: dup.status, action: "existing" },
        { status: 200 },
      );
    }
  }

  // Account exists?
  const { data: account, error: accErr } = await supabase
    .from("accounts")
    .select("id, company_name")
    .eq("id", accountId)
    .maybeSingle();
  if (accErr) {
    console.error("[api/quotes] account lookup failed:", accErr.message);
    return NextResponse.json({ error: "Account lookup failed." }, { status: 500 });
  }
  if (!account) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  // Find or create a client in this account matching the email.
  let clientId: string | null = null;
  {
    const { data: existing, error: findErr } = await supabase
      .from("clients")
      .select("id")
      .eq("source_account_id", accountId)
      .ilike("email", clientEmail)
      .limit(1)
      .maybeSingle();
    if (findErr) {
      console.error("[api/quotes] client lookup failed:", findErr.message);
      return NextResponse.json({ error: "Client lookup failed." }, { status: 500 });
    }
    if (existing?.id) {
      clientId = existing.id as string;
    } else {
      const { data: created, error: createErr } = await supabase
        .from("clients")
        .insert({
          full_name: clientName,
          email: clientEmail,
          client_type: "commercial",
          source: "corporate",
          source_account_id: accountId,
        })
        .select("id")
        .single();
      if (createErr || !created) {
        console.error("[api/quotes] client create failed:", createErr?.message);
        return NextResponse.json({ error: "Could not create client." }, { status: 500 });
      }
      clientId = created.id as string;
    }
  }

  // Generate next reference via the same RPC the dashboard uses.
  const { data: ref, error: refErr } = await supabase.rpc("next_quote_ref");
  if (refErr) {
    console.error("[api/quotes] next_quote_ref failed:", refErr.message);
    return NextResponse.json({ error: "Could not generate reference." }, { status: 500 });
  }

  // Insert the quote.
  const status    = typeOfQuoting === "bidding" ? "bidding"  : "draft";
  const quoteType = typeOfQuoting === "bidding" ? "partner"  : "internal";

  const { data: inserted, error: insErr } = await supabase
    .from("quotes")
    .insert({
      reference:            ref,
      title,
      status,
      client_id:            clientId,
      client_name:          clientName,
      client_email:         clientEmail,
      scope:                description,
      service_type:         serviceType,
      start_date_option_1:  startIso,
      total_value:          0,
      cost:                 0,
      sell_price:           0,
      margin_percent:       0,
      partner_cost:         0,
      partner_quotes_count: 0,
      quote_type:           quoteType,
      customer_accepted:    false,
      customer_deposit_paid: false,
      ...(ticketId ? { external_source: "zendesk", external_ref: ticketId } : {}),
    })
    .select("id, reference, status")
    .single();
  if (insErr || !inserted) {
    console.error("[api/quotes] insert failed:", insErr?.message);
    return NextResponse.json({ error: insErr?.message ?? "Could not create quote." }, { status: 500 });
  }

  // Broadcast to matching partners if this is a bidding quote.
  // Don't fail the whole request if push fails — quote is already saved.
  let partnersNotified: { sent: number; errors: number; tokensFound: number } | undefined;
  if (typeOfQuoting === "bidding" && serviceType) {
    try {
      partnersNotified = await broadcastQuoteToPartners(supabase, {
        quoteId:     String(inserted.id),
        reference:   String(inserted.reference),
        title,
        serviceType,
        startIso,
      });
    } catch (err) {
      console.error("[api/quotes] partner broadcast failed:", err);
      partnersNotified = { sent: 0, errors: 0, tokensFound: 0 };
    }
  }

  return NextResponse.json(
    {
      id:        inserted.id,
      reference: inserted.reference,
      status:    inserted.status,
      ...(partnersNotified ? { partners_notified: partnersNotified } : {}),
    },
    { status: 201 },
  );
}

/** Broadcast an Expo push to every active partner whose trades array
 *  contains `serviceType` (or the legacy single `trade` column matches).
 *  Mirrors the logic in /api/push/notify-partner but runs inline because
 *  this webhook has no user session. */
async function broadcastQuoteToPartners(
  supabase: SupabaseClient,
  args: {
    quoteId:     string;
    reference:   string;
    title:       string;
    serviceType: string;
    startIso:    string;
  },
): Promise<{ sent: number; errors: number; tokensFound: number }> {
  const safeTrade = safePostgrestEnumValue(args.serviceType);
  if (!safeTrade) return { sent: 0, errors: 0, tokensFound: 0 };

  const { data: partners, error } = await supabase
    .from("partners")
    .select("id, auth_user_id, expo_push_token")
    .or(`trades.cs.{${safeTrade}},trade.eq.${safeTrade}`)
    .eq("status", "active");
  if (error) {
    console.error("[api/quotes] partners lookup failed:", error.message);
    return { sent: 0, errors: 0, tokensFound: 0 };
  }

  const rows = partners ?? [];
  const directTokens = rows
    .map((r) => r.expo_push_token as string | null)
    .filter((t): t is string => !!t);
  const missingAuthIds = rows
    .filter((r) => !r.expo_push_token && r.auth_user_id)
    .map((r) => r.auth_user_id as string);

  let fallbackTokens: string[] = [];
  if (missingAuthIds.length > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("id, fcmToken")
      .in("id", missingAuthIds)
      .not("fcmToken", "is", null);
    fallbackTokens = (users ?? [])
      .map((u: { fcmToken: string | null }) => u.fcmToken)
      .filter((t): t is string => !!t);
  }

  const tokens = [...new Set([...directTokens, ...fallbackTokens])];
  if (tokens.length === 0) return { sent: 0, errors: 0, tokensFound: 0 };

  const data = {
    type:      "quote_invite" as const,
    quoteId:   args.quoteId,
    reference: args.reference,
    serviceType: args.serviceType,
    startAt:   args.startIso,
  };
  const messages = tokens.map((to) => ({
    to,
    title: `New job available — ${args.serviceType}`,
    body:  args.title,
    data,
    sound: "default",
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body:    JSON.stringify(messages),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[api/quotes] Expo push ${res.status}:`, text);
      return { sent: 0, errors: tokens.length, tokensFound: tokens.length };
    }
    const json = await res.json();
    const errors = (json?.data ?? []).filter((r: { status?: string }) => r.status === "error").length;
    return { sent: tokens.length - errors, errors, tokensFound: tokens.length };
  } catch (err) {
    console.error("[api/quotes] Expo fetch failed:", err);
    return { sent: 0, errors: tokens.length, tokensFound: tokens.length };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Accepts `YYYY-MM-DD`, `DD-MM-YYYY`, `DD-MM-YY`, `DD/MM/YYYY`, or
 *  `DD/MM/YY` and returns canonical `YYYY-MM-DD`. Two-digit years are
 *  read as 20YY (UK B2B context — not bookings 100 years in the past).
 *  Returns null if the format doesn't match or the calendar date is
 *  invalid (e.g. 31-02-2026). */
function normalizeDateToIso(input: string): string | null {
  // Already ISO?
  let m = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return validateYmd(m[1], m[2], m[3]);

  // DD-MM-YYYY or DD/MM/YYYY
  m = input.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (m) return validateYmd(m[3], m[2], m[1]);

  // DD-MM-YY or DD/MM/YY → 20YY
  m = input.match(/^(\d{2})[-/](\d{2})[-/](\d{2})$/);
  if (m) return validateYmd(`20${m[3]}`, m[2], m[1]);

  return null;
}

function validateYmd(yyyy: string, mm: string, dd: string): string | null {
  const dt = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  // Reject calendar overflow (e.g. 31-02 → 03-03 silently).
  if (
    dt.getUTCFullYear() !== Number(yyyy) ||
    dt.getUTCMonth() + 1 !== Number(mm) ||
    dt.getUTCDate() !== Number(dd)
  ) return null;
  return `${yyyy}-${mm}-${dd}`;
}

/** Combines `YYYY-MM-DD` + `HH:MM` into an ISO timestamp (local-naive,
 *  serialized as UTC). Returns null if either piece is invalid. */
function combineDateHourToIso(date: string, hour: string): string | null {
  const dt = new Date(`${date}T${hour}:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
