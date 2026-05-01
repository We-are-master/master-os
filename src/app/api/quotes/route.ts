import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { isValidUUID } from "@/lib/auth-api";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

/**
 * POST /api/quotes
 *
 * Creates a draft quote from an external caller (n8n, integration scripts).
 * Auth: header `X-API-Key` must match env `MASTER_OS_QUOTE_WEBHOOK_API_KEY`.
 *
 * Body (JSON):
 *   {
 *     account_id:    uuid,           // accounts.id — required
 *     date:          "YYYY-MM-DD",   // required
 *     hour:          "HH:MM",        // required, 24h
 *     title:         string,         // required
 *     client_name:   string,         // required
 *     client_email:  string,         // required
 *     description?:  string,         // → quotes.scope
 *     service_type?: string          // trade label (Plumbing, Electrical, etc.)
 *   }
 *
 * Behavior:
 *   - Finds (or creates) a clients row in the given account matching
 *     client_email, then attaches the new quote to it. The account
 *     linkage flows through clients.source_account_id → accounts.id.
 *   - date + hour are combined into quotes.start_date_option_1 (ISO).
 *   - status is hard-coded to 'draft'.
 *
 * Response: 201 { id, reference, status }
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

  const accountId   = str(body.account_id);
  const date        = str(body.date);
  const hour        = str(body.hour);
  const title       = str(body.title);
  const clientName  = str(body.client_name);
  const clientEmail = str(body.client_email).toLowerCase();
  const description = str(body.description) || null;
  const serviceType = str(body.service_type) || null;

  // ─── Validation ──────────────────────────────────────────────────────
  if (!accountId || !date || !hour || !title || !clientName || !clientEmail) {
    return NextResponse.json(
      { error: "account_id, date, hour, title, client_name, and client_email are required." },
      { status: 400 },
    );
  }
  if (!isValidUUID(accountId)) {
    return NextResponse.json({ error: "account_id must be a valid UUID." }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD." }, { status: 400 });
  }
  if (!/^\d{2}:\d{2}$/.test(hour)) {
    return NextResponse.json({ error: "hour must be HH:MM (24h)." }, { status: 400 });
  }
  if (!clientEmail.includes("@")) {
    return NextResponse.json({ error: "client_email must be a valid email." }, { status: 400 });
  }

  const startIso = combineDateHourToIso(date, hour);
  if (!startIso) {
    return NextResponse.json({ error: "date + hour did not parse to a valid timestamp." }, { status: 400 });
  }

  // ─── DB ──────────────────────────────────────────────────────────────
  const supabase = createServiceClient();

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
  const { data: inserted, error: insErr } = await supabase
    .from("quotes")
    .insert({
      reference:            ref,
      title,
      status:               "draft",
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
      quote_type:           "internal",
      customer_accepted:    false,
      customer_deposit_paid: false,
    })
    .select("id, reference, status")
    .single();
  if (insErr || !inserted) {
    console.error("[api/quotes] insert failed:", insErr?.message);
    return NextResponse.json({ error: insErr?.message ?? "Could not create quote." }, { status: 500 });
  }

  return NextResponse.json(
    { id: inserted.id, reference: inserted.reference, status: inserted.status },
    { status: 201 },
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
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
