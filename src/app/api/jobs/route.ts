import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { isValidUUID } from "@/lib/auth-api";
import { partnerMatchesTypeOfWork } from "@/lib/partner-type-of-work-match";
import type { Partner } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * POST /api/jobs
 *
 * Creates a job from an external caller (n8n, integration scripts).
 * Auth: header `X-API-Key` must match env `MASTER_OS_JOB_WEBHOOK_API_KEY`.
 *
 * Body (JSON):
 *   {
 *     account_id:       uuid,    // accounts.id — required
 *     date:             string,  // YYYY-MM-DD, DD-MM-YYYY, DD-MM-YY, DD/MM/YYYY, DD/MM/YY
 *     hour:             "HH:MM", // 24h, required
 *     title:            string,  // required
 *     client_name:      string,  // required
 *     client_email:     string,  // required
 *     property_address: string,  // required (geocoded by app for partner map)
 *     service_type:     string,  // required (trade — used for partner matching)
 *     description?:     string,  // → jobs.report_notes (free-form context)
 *     client_price?:    number,  // £ charged to the client (default 0)
 *     partner_cost?:    number,  // £ paid to the partner   (default 0)
 *     auto_assign?:     boolean, // when true → status='auto_assigning'
 *                                  + push notify partners matching service_type
 *                                  via the existing offer-window mechanism
 *                                  (mig 080). Default false → status='unassigned',
 *                                  staff picks partner manually.
 *     ticket_id?:       string   // Zendesk ticket id — stored as
 *                                  //   external_source='zendesk',
 *                                  //   external_ref=ticket_id.
 *                                  //   Re-posting the same id returns the
 *                                  //   existing job (idempotent).
 *   }
 *
 * Behavior:
 *   - Finds (or creates) a clients row in the given account matching
 *     client_email, then attaches the new job to it.
 *   - date + hour → scheduled_start_at (timestamptz) and scheduled_date.
 *   - Generates next reference via the existing next_job_ref RPC.
 *   - When auto_assign=true: matches active partners by service_type
 *     (using the same partnerMatchesTypeOfWork rules the Desk webhook
 *     uses), stores their ids in auto_assign_invited_partner_ids, and
 *     sends an Expo push. Falls back to status='unassigned' if no
 *     partner matched.
 *
 * Response: 201 { id, reference, status, partners_notified? }
 */
export async function POST(req: NextRequest) {
  // ─── Auth ────────────────────────────────────────────────────────────
  const provided = req.headers.get("x-api-key");
  const expected = process.env.MASTER_OS_JOB_WEBHOOK_API_KEY?.trim();
  if (!expected) {
    console.error("[api/jobs] MASTER_OS_JOB_WEBHOOK_API_KEY not configured");
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
  const propertyAddress = str(body.property_address);
  const serviceType     = str(body.service_type);
  const description     = str(body.description) || null;
  const clientPrice     = num(body.client_price);
  const partnerCost     = num(body.partner_cost);
  const autoAssign      = body.auto_assign === true || /^true$/i.test(str(body.auto_assign));
  const ticketId        = str(body.ticket_id) || null;

  // ─── Validation ──────────────────────────────────────────────────────
  if (
    !accountId || !date || !hour || !title ||
    !clientName || !clientEmail || !propertyAddress || !serviceType
  ) {
    return NextResponse.json(
      {
        error:
          "account_id, date, hour, title, client_name, client_email, " +
          "property_address, and service_type are required.",
      },
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
  // job for it, return the existing row instead of duplicating.
  if (ticketId) {
    const { data: dup } = await supabase
      .from("jobs")
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
    console.error("[api/jobs] account lookup failed:", accErr.message);
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
      console.error("[api/jobs] client lookup failed:", findErr.message);
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
        console.error("[api/jobs] client create failed:", createErr?.message);
        return NextResponse.json({ error: "Could not create client." }, { status: 500 });
      }
      clientId = created.id as string;
    }
  }

  // ─── Partner matching (when auto_assign is on) ──────────────────────
  let matchedPartnerIds: string[] = [];
  if (autoAssign) {
    const { data: activePartners } = await supabase
      .from("partners")
      .select("id, trade, trades, company_name, contact_name, expo_push_token, auth_user_id, uk_coverage_regions")
      .eq("status", "active");
    if (activePartners) {
      matchedPartnerIds = (activePartners as unknown as Partner[])
        .filter((p) => partnerMatchesTypeOfWork(p, serviceType))
        .map((p) => p.id);
    }
  }

  // ─── Determine status ───────────────────────────────────────────────
  const status =
    autoAssign && matchedPartnerIds.length > 0 ? "auto_assigning" : "unassigned";

  // ─── Reference ──────────────────────────────────────────────────────
  const { data: ref, error: refErr } = await supabase.rpc("next_job_ref");
  if (refErr || !ref) {
    console.error("[api/jobs] next_job_ref failed:", refErr?.message);
    return NextResponse.json({ error: "Could not generate reference." }, { status: 500 });
  }

  // ─── Insert ────────────────────────────────────────────────────────
  const margin =
    clientPrice > 0 && partnerCost > 0
      ? Math.round(((clientPrice - partnerCost) / clientPrice) * 10000) / 100
      : 0;

  const jobRow: Record<string, unknown> = {
    reference:          String(ref),
    title,
    client_id:          clientId,
    client_name:        clientName,
    property_address:   propertyAddress,
    service_type:       serviceType,
    status,
    client_price:       clientPrice,
    partner_cost:       partnerCost,
    materials_cost:     0,
    margin_percent:     margin,
    scheduled_date:     isoDate,
    scheduled_start_at: startIso,
    total_phases:       2,
    progress:           0,
    current_phase:      0,
    job_type:           "fixed",
    finance_status:     "unpaid",
    report_notes:       description,
  };
  if (autoAssign && matchedPartnerIds.length > 0) {
    jobRow.auto_assign_invited_partner_ids = matchedPartnerIds;
  }
  if (ticketId) {
    jobRow.external_source = "zendesk";
    jobRow.external_ref    = ticketId;
  }

  const { data: inserted, error: insErr } = await supabase
    .from("jobs")
    .insert(jobRow)
    .select("id, reference, status")
    .single();
  if (insErr || !inserted) {
    console.error("[api/jobs] insert failed:", insErr?.message);
    return NextResponse.json({ error: insErr?.message ?? "Could not create job." }, { status: 500 });
  }

  // ─── Push notifications (best effort) ───────────────────────────────
  let partnersNotified: { sent: number; tokensFound: number } | undefined;
  if (autoAssign && matchedPartnerIds.length > 0) {
    try {
      partnersNotified = await sendPushToPartners(supabase, matchedPartnerIds, {
        title: "New job available",
        body:  `${inserted.reference} · ${title} · ${propertyAddress}`,
        data:  { type: "job_assigned", jobId: String(inserted.id) },
      });
    } catch (err) {
      console.error("[api/jobs] push failed:", err);
      partnersNotified = { sent: 0, tokensFound: 0 };
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

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Accepts `YYYY-MM-DD`, `DD-MM-YYYY`, `DD-MM-YY`, `DD/MM/YYYY`, or
 *  `DD/MM/YY` and returns canonical `YYYY-MM-DD`. Two-digit years are
 *  read as 20YY. Returns null if the calendar date is invalid. */
function normalizeDateToIso(input: string): string | null {
  let m = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return validateYmd(m[1], m[2], m[3]);
  m = input.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (m) return validateYmd(m[3], m[2], m[1]);
  m = input.match(/^(\d{2})[-/](\d{2})[-/](\d{2})$/);
  if (m) return validateYmd(`20${m[3]}`, m[2], m[1]);
  return null;
}

function validateYmd(yyyy: string, mm: string, dd: string): string | null {
  const dt = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  if (
    dt.getUTCFullYear() !== Number(yyyy) ||
    dt.getUTCMonth() + 1 !== Number(mm) ||
    dt.getUTCDate() !== Number(dd)
  ) return null;
  return `${yyyy}-${mm}-${dd}`;
}

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

async function sendPushToPartners(
  supabase: SupabaseClient,
  partnerIds: string[],
  notification: { title: string; body: string; data: Record<string, unknown> },
): Promise<{ sent: number; tokensFound: number }> {
  if (!partnerIds.length) return { sent: 0, tokensFound: 0 };

  const { data: partners } = await supabase
    .from("partners")
    .select("id, expo_push_token, auth_user_id")
    .in("id", partnerIds)
    .eq("status", "active");

  const tokens: string[] = [];
  const missingAuthIds: string[] = [];
  for (const p of (partners ?? []) as { expo_push_token: string | null; auth_user_id: string | null }[]) {
    if (p.expo_push_token) tokens.push(p.expo_push_token);
    else if (p.auth_user_id) missingAuthIds.push(p.auth_user_id);
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
  const dedup = [...new Set(tokens)];
  if (!dedup.length) return { sent: 0, tokensFound: 0 };

  try {
    const messages = dedup.map((to) => ({
      to,
      title: notification.title,
      body:  notification.body.slice(0, 500),
      data:  notification.data,
      sound: "default" as const,
    }));
    const res = await fetch(EXPO_PUSH_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body:    JSON.stringify(messages),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[api/jobs] Expo push ${res.status}:`, text);
      return { sent: 0, tokensFound: dedup.length };
    }
    return { sent: dedup.length, tokensFound: dedup.length };
  } catch (err) {
    console.error("[api/jobs] Expo fetch failed:", err);
    return { sent: 0, tokensFound: dedup.length };
  }
}
