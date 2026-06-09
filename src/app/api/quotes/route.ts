import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { isValidUUID } from "@/lib/auth-api";
import { isPostgrestWriteRetryableError } from "@/lib/postgrest-errors";
import { dispatchQuoteBidInvites } from "@/lib/quote-bid-invites";
import { syncQuoteZendeskFormFields } from "@/lib/zendesk-ticket-form-sync";
import { syncQuoteZendeskStatus } from "@/lib/zendesk-status-sync";
import { resolveClientIdForZendeskJob } from "@/lib/zendesk-job-client-resolve";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

/**
 * POST /api/quotes
 *
 * Creates a draft quote from an external caller (Zendesk webhooks, integration scripts).
 * Auth: header `X-API-Key` must match env `MASTER_OS_QUOTE_WEBHOOK_API_KEY`.
 *
 * Body (JSON):
 *   {
 *     account_id:       uuid,                  // accounts.id — required
 *     title?:           string,                // optional when catalog_service_id (or service_type)
 *                                              //   is sent — the resolved service name becomes the title
 *     date?:            string,                // optional. YYYY-MM-DD, DD-MM-YYYY, DD-MM-YY, DD/MM/YYYY, DD/MM/YY
 *     hour?:            "HH:MM",               // optional, 24h. Combined with `date` into start_date_option_1.
 *     client_name?:     string,                // optional. When BOTH name+email are present we look up
 *     client_email?:    string,                //   the client by email and create one if missing.
 *                                              //   When either is omitted the quote is saved with
 *                                              //   client_id=null and the free-text fields kept as-is.
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
  // `scope` is accepted as an alias for `description` (Zendesk form field name).
  const description     = (str(body.description) || str(body.scope)) || null;
  const serviceType     = str(body.service_type) || null;
  const ticketId        = str(body.ticket_id) || null;
  const propertyAddress = str(body.property_address) || null;
  const catalogServiceId = str(body.catalog_service_id) || null;
  // `quote_mode` is an alias for `type_of_quoting` (Zendesk form field name).
  const typeOfQuotingRaw = str(body.type_of_quoting) || str(body.quote_mode) || "manual";
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
  // Only `account_id` is strictly required. `title` is optional when a
  // catalog_service_id (or service_type) is sent — the resolved service name
  // becomes the quote title. Date/hour and the client identity are also
  // optional — quotes can be drafted without a confirmed schedule or before a
  // client record exists in the OS.
  if (!accountId) {
    return NextResponse.json(
      { error: "account_id is required." },
      { status: 400 },
    );
  }
  if (!title && !catalogServiceId && !serviceType) {
    return NextResponse.json(
      { error: "title is required (or send catalog_service_id / service_type to derive it)." },
      { status: 400 },
    );
  }
  if (typeOfQuoting === "bidding" && !serviceType && !catalogServiceId) {
    return NextResponse.json(
      { error: "service_type or catalog_service_id is required when bidding (used to match partners)." },
      { status: 400 },
    );
  }
  if (!isValidUUID(accountId)) {
    return NextResponse.json({ error: "account_id must be a valid UUID." }, { status: 400 });
  }
  if (catalogServiceId && !isValidUUID(catalogServiceId)) {
    return NextResponse.json({ error: "catalog_service_id must be a valid UUID." }, { status: 400 });
  }

  // Date/hour: only validated if provided. If only one of the two is given
  // we ignore the partial input rather than fail the whole request.
  let isoDate: string | null = null;
  if (date) {
    isoDate = normalizeDateToIso(date);
    if (!isoDate) {
      return NextResponse.json(
        { error: "date must be YYYY-MM-DD, DD-MM-YYYY, DD-MM-YY, DD/MM/YYYY, or DD/MM/YY." },
        { status: 400 },
      );
    }
  }
  if (hour && !/^\d{2}:\d{2}$/.test(hour)) {
    return NextResponse.json({ error: "hour must be HH:MM (24h)." }, { status: 400 });
  }
  if (clientEmail && !clientEmail.includes("@")) {
    return NextResponse.json({ error: "client_email must be a valid email." }, { status: 400 });
  }

  const startIso = isoDate && hour ? combineDateHourToIso(isoDate, hour) : null;
  if (isoDate && hour && !startIso) {
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

  const accountCompanyName = String((account as { company_name?: string }).company_name ?? "").trim();

  let clientId: string | null = null;
  let resolvedClientFullName = clientName;
  if (clientEmail && clientName) {
    try {
      const resolved = await resolveClientIdForZendeskJob(supabase, {
        accountId,
        clientName,
        clientEmail,
        clientPhone: null,
        accountCompanyName: accountCompanyName || null,
      });
      clientId = resolved.clientId;
      resolvedClientFullName = resolved.clientFullName;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Client lookup failed.";
      console.error("[api/quotes] client resolve failed:", message);
      return NextResponse.json({ error: "Client lookup failed." }, { status: 500 });
    }
  }

  // Generate next reference via the same RPC the dashboard uses.
  const { data: ref, error: refErr } = await supabase.rpc("next_quote_ref");
  if (refErr) {
    console.error("[api/quotes] next_quote_ref failed:", refErr.message);
    return NextResponse.json({ error: "Could not generate reference." }, { status: 500 });
  }

  // Always resolve the catalog service NAME when an id is supplied. The name is
  // the authoritative, human-readable label — the raw catalog UUID must never
  // surface in the quote title or partner emails (it reads as gibberish). The
  // resolved name wins over a free-text `service_type`, so even a caller that
  // mistakenly puts the id in `service_type` still gets the proper name.
  let catalogName: string | null = null;
  if (catalogServiceId) {
    const { data: cat } = await supabase
      .from("service_catalog")
      .select("name")
      .eq("id", catalogServiceId)
      .maybeSingle();
    catalogName = (cat as { name?: string } | null)?.name ?? null;
  }
  const resolvedServiceType = catalogName || serviceType || null;

  // Title: prefer an explicit human title, but never accept the catalog UUID
  // itself (some integrations send the id in `title`). Fall back to the
  // resolved service name. quotes.title is NOT NULL, so this must be non-empty.
  const titleIsId = !!title && (title === catalogServiceId || isValidUUID(title));
  const effectiveTitle = (title && !titleIsId ? title : null) || resolvedServiceType;
  if (!effectiveTitle) {
    return NextResponse.json(
      { error: "Could not determine a title: provide `title`, or a `catalog_service_id` that resolves to a service name." },
      { status: 400 },
    );
  }

  // Insert the quote.
  const status    = typeOfQuoting === "bidding" ? "bidding"  : "draft";
  const quoteType = typeOfQuoting === "bidding" ? "partner"  : "internal";

  const baseQuoteRow = {
    reference:            ref,
    title:                effectiveTitle,
    status,
    client_id:            clientId,
    client_name:          resolvedClientFullName || clientName || null,
    client_email:         clientEmail || null,
    scope:                description,
    service_type:         resolvedServiceType,
    property_address:     propertyAddress,
    catalog_service_id:   catalogServiceId,
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
  };
  // Newer column from mig 165 — wrap optimistically. When the DB / PostgREST
  // schema cache is behind, retry without it.
  const quoteRowWithExtras = { ...baseQuoteRow, draft_route_completed: true };

  type QuoteInsertResult = { id: string; reference: string; status: string };
  type InsertErr = { message: string; code?: string };

  let inserted: QuoteInsertResult | null = null;
  let insErr: InsertErr | null = null;
  {
    const r1 = await supabase
      .from("quotes")
      .insert(quoteRowWithExtras)
      .select("id, reference, status")
      .single();
    inserted = (r1.data as QuoteInsertResult | null) ?? null;
    insErr = (r1.error as InsertErr | null) ?? null;
    if (insErr && isPostgrestWriteRetryableError(insErr)) {
      console.warn(
        "[api/quotes] insert hit schema cache miss, retrying without draft_route_completed:",
        insErr.message,
      );
      const r2 = await supabase
        .from("quotes")
        .insert(baseQuoteRow)
        .select("id, reference, status")
        .single();
      inserted = (r2.data as QuoteInsertResult | null) ?? null;
      insErr = (r2.error as InsertErr | null) ?? null;
    }
  }
  if (insErr || !inserted) {
    console.error("[api/quotes] insert failed:", insErr?.message);
    return NextResponse.json({ error: insErr?.message ?? "Could not create quote." }, { status: 500 });
  }

  if (ticketId) {
    void Promise.all([
      syncQuoteZendeskStatus(inserted.id, supabase),
      syncQuoteZendeskFormFields(inserted.id, supabase),
    ]).catch((err) => {
      console.error("[api/quotes] Zendesk dispatch failed:", err);
    });
  }

  // Broadcast to matching partners if this is a bidding quote.
  // Don't fail the whole request if dispatch fails — quote is already saved.
  let partnersNotified:
    | { partnerIds: number; pushSent: number; emailsSent: number; invitationsTracked: number }
    | undefined;
  if (typeOfQuoting === "bidding" && (resolvedServiceType || catalogServiceId)) {
    try {
      const dispatch = await dispatchQuoteBidInvites(supabase, {
        quoteId: String(inserted.id),
        quoteReference: String(inserted.reference),
        title: effectiveTitle,
        serviceType: resolvedServiceType ?? "",
        catalogServiceId,
        propertyAddress,
        scope: description,
        startIso,
      });
      partnersNotified = {
        partnerIds: dispatch.partnerIds.length,
        pushSent: dispatch.pushSent,
        emailsSent: dispatch.emailsSent,
        invitationsTracked: dispatch.invitationsTracked,
      };
    } catch (err) {
      console.error("[api/quotes] partner dispatch failed:", err);
      partnersNotified = { partnerIds: 0, pushSent: 0, emailsSent: 0, invitationsTracked: 0 };
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
