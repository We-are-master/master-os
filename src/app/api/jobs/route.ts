import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { isValidUUID } from "@/lib/auth-api";
import { matchPartnerIdsForWork } from "@/lib/partner-work-matching";
import { extractUkPostcode } from "@/lib/uk-postcode";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchJobCreatedZendesk } from "@/lib/zendesk-lifecycle";
import { syncJobZendeskStatus } from "@/lib/zendesk-status-sync";
import { ukWallClockToUtcIso } from "@/lib/utils/uk-time";
import { catalogServiceIdForTypeOfWorkLabel } from "@/lib/type-of-work";
import { resolveJobPricing } from "@/lib/job-pricing-resolver";
import type {
  AccountServicePrice,
  CatalogService,
} from "@/types/database";

const AUTO_PARTNER_MARGIN_PCT = 40;

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
 *     account_id:       uuid,        // accounts.id — required
 *     date:             string,      // YYYY-MM-DD, DD-MM-YYYY, DD-MM-YY, DD/MM/YYYY, DD/MM/YY
 *     arrival_time:     string,      // UK wall-clock arrival window. Required.
 *                                    //   Accepts:
 *                                    //   - "HH:MM - HH:MM"  (e.g. "09:00-12:00",
 *                                    //                       "09:00 – 12:00";
 *                                    //                       hyphen, en-dash and
 *                                    //                       em-dash all work,
 *                                    //                       spaces optional).
 *                                    //   - "HH:MM"          (single time, no
 *                                    //                       end window).
 *                                    //   - Slot tag from the Zendesk Arrival
 *                                    //     Window field — `earlier_morning`,
 *                                    //     `arrival_morning`,
 *                                    //     `arrival_early_afternoon`,
 *                                    //     `arrival_late_afternoon`,
 *                                    //     `arrival_evening` — or the bare slot
 *                                    //     id without the `arrival_` prefix.
 *                                    //     Mapped to the canonical windows
 *                                    //     (earlier morning 08–09, morning
 *                                    //     09–12, early afternoon 13–15,
 *                                    //     late afternoon 15–18, evening
 *                                    //     18–20).
 *     title:            string,      // required
 *     client_name:      string,      // required
 *     client_email:     string,      // required
 *     client_phone?:    string,      // optional contact phone. On creation it
 *                                    //   lands on clients.phone. When the
 *                                    //   client already exists with an empty
 *                                    //   phone, this value backfills it; a
 *                                    //   non-empty phone is never overwritten.
 *     property_address: string,      // required (geocoded by app for partner map)
 *     service_type:     string,      // required (trade — used for partner matching)
 *     description?:     string,      // → jobs.scope (work brief — same field as quotes.scope)
 *     rate_type?:       "fixed"|"hourly", // pricing mode (default "fixed").
 *                                    //   The Zendesk Job Type tag form
 *                                    //   (`job_type_fixed` / `job_type_hourly`)
 *                                    //   is also accepted — the prefix is
 *                                    //   stripped before validation.
 *                                    //   - fixed:  uses client_price / partner_cost.
 *                                    //   - hourly: rates come from the Services
 *                                    //             catalog (account override →
 *                                    //             standard). hourly_client_rate
 *                                    //             / hourly_partner_rate from the
 *                                    //             payload act as overrides when
 *                                    //             present. Headline client_price
 *                                    //             / partner_cost are stored as 0
 *                                    //             — totals get computed from
 *                                    //             billed_hours later.
 *     catalog_service_id?: string,   // [hourly] optional UUID of the
 *                                    //   service_catalog row to use. When
 *                                    //   omitted, the API matches service_type
 *                                    //   to the catalog by exact name → normalized
 *                                    //   canonical type-of-work. Match must be
 *                                    //   unambiguous.
 *     client_price?:    number|str,  // [fixed] £ charged to the client (default 0).
 *                                    //   Strings like "£177.60" / "177,60" /
 *                                    //   "1,234.50" are accepted — currency,
 *                                    //   spaces and UK/EU number formatting
 *                                    //   get normalized.
 *     partner_cost?:    number|str,  // [fixed] £ paid to the partner. When
 *                                    //   OMITTED and client_price > 0, defaults
 *                                    //   to round(client_price * 0.60, 2) so the
 *                                    //   standard 40% margin is applied
 *                                    //   automatically. Send an explicit 0 to
 *                                    //   opt out.
 *     hourly_client_rate?: number|str,    // [hourly] £/h charged to the
 *                                    //   client. Optional — when omitted, the
 *                                    //   API resolves it from
 *                                    //   account_service_prices (override) or
 *                                    //   service_catalog (standard). Must end up
 *                                    //   > 0 from one of those sources, else 400.
 *     hourly_partner_rate?: number|str,   // [hourly] £/h paid to the partner.
 *                                    //   Optional — when omitted, defaults to
 *                                    //   the auto-40% margin
 *                                    //   round(hourly_client_rate * 0.60, 2).
 *     auto_assign?:     boolean,     // when true → status='auto_assigning'
 *                                    //   + push notify partners matching service_type
 *                                    //   via the existing offer-window mechanism
 *                                    //   (mig 080). Default false → status='unassigned',
 *                                    //   staff picks partner manually.
 *     ticket_id?:       string       // Zendesk ticket id — stored as
 *                                    //   external_source='zendesk',
 *                                    //   external_ref=ticket_id.
 *                                    //   Re-posting the same id returns the
 *                                    //   existing job (idempotent).
 *                                    //   If a QUOTE already exists with this
 *                                    //   ticket_id (e.g. created by an earlier
 *                                    //   Zendesk macro), the job is created
 *                                    //   linked to it (jobs.quote_id) and the
 *                                    //   quote is marked status='converted_to_job'.
 *   }
 *
 * Behavior:
 *   - Finds (or creates) a clients row in the given account matching
 *     client_email, then attaches the new job to it. client_phone is
 *     stored on creation and backfilled on existing clients only when
 *     they don't have a phone yet.
 *   - date + arrival_time → scheduled_date, scheduled_start_at and
 *     scheduled_end_at (DST-safe UK wall-clock conversion).
 *   - Generates next reference via the existing next_job_ref RPC.
 *   - When partner_cost (fixed) or hourly_partner_rate (hourly) is missing
 *     and the client-side value is > 0, applies the standard 40% margin:
 *     partner side = round(client side * 0.60, 2).
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
  const arrivalTime     = str(body.arrival_time);
  const title           = str(body.title);
  const clientName      = str(body.client_name);
  const clientEmail     = str(body.client_email).toLowerCase();
  const clientPhone     = str(body.client_phone) || null;
  const propertyAddress = str(body.property_address);
  const serviceType     = str(body.service_type);
  const description     = str(body.description) || null;
  // Accept either the bare value (`hourly` / `fixed`) or the Zendesk Job Type
  // field tag form (`job_type_hourly` / `job_type_fixed`) — the prefix is
  // stripped so the macro can post the tag straight through.
  const rateType        = (
    str(body.rate_type).toLowerCase().replace(/^job[_-]type[_-]/, "") || "fixed"
  ) as "fixed" | "hourly";
  const catalogServiceIdIn = str(body.catalog_service_id) || null;
  const autoAssign      = body.auto_assign === true || /^true$/i.test(str(body.auto_assign));
  const ticketId        = str(body.ticket_id) || null;

  // Distinguish "omitted" from "explicit 0" so we can auto-apply the standard
  // 40% partner margin when the caller didn't send a partner-side amount.
  // The two pricing modes use different columns:
  //   fixed  → client_price / partner_cost
  //   hourly → hourly_client_rate / hourly_partner_rate
  const clientPrice          = num(body.client_price);
  const partnerCostSent      = isPresent(body.partner_cost);
  const partnerCost          = partnerCostSent
    ? num(body.partner_cost)
    : clientPrice > 0
      ? autoMargin(clientPrice)
      : 0;
  // For hourly: the body values act as caller overrides; when omitted, rates
  // are resolved later from the Services catalog (account override → standard)
  // and partner rate falls back to auto 40%.
  const hourlyClientRateSent = isPresent(body.hourly_client_rate);
  const hourlyClientRateIn   = num(body.hourly_client_rate);
  const hourlyPartnerRateSet = isPresent(body.hourly_partner_rate);
  const hourlyPartnerRateIn  = num(body.hourly_partner_rate);

  // ─── Validation ──────────────────────────────────────────────────────
  if (
    !accountId || !date || !arrivalTime || !title ||
    !clientName || !clientEmail || !propertyAddress || !serviceType
  ) {
    return NextResponse.json(
      {
        error:
          "account_id, date, arrival_time, title, client_name, client_email, " +
          "property_address, and service_type are required.",
      },
      { status: 400 },
    );
  }
  if (!isValidUUID(accountId)) {
    return NextResponse.json({ error: "account_id must be a valid UUID." }, { status: 400 });
  }
  if (rateType !== "fixed" && rateType !== "hourly") {
    return NextResponse.json({ error: "rate_type must be 'fixed' or 'hourly'." }, { status: 400 });
  }
  if (catalogServiceIdIn && !isValidUUID(catalogServiceIdIn)) {
    return NextResponse.json(
      { error: "catalog_service_id must be a valid UUID when provided." },
      { status: 400 },
    );
  }
  const isoDate = normalizeDateToIso(date);
  if (!isoDate) {
    return NextResponse.json(
      { error: "date must be YYYY-MM-DD, DD-MM-YYYY, DD-MM-YY, DD/MM/YYYY, or DD/MM/YY." },
      { status: 400 },
    );
  }
  const arrivalWindow = parseArrivalTime(arrivalTime);
  if (!arrivalWindow) {
    return NextResponse.json(
      { error: "arrival_time must be \"HH:MM - HH:MM\" or \"HH:MM\" (24h, UK wall-clock)." },
      { status: 400 },
    );
  }
  if (!clientEmail.includes("@")) {
    return NextResponse.json({ error: "client_email must be a valid email." }, { status: 400 });
  }

  const startIso = ukWallClockToUtcIso(isoDate, arrivalWindow.start);
  if (!startIso) {
    return NextResponse.json({ error: "date + arrival_time did not parse to a valid timestamp." }, { status: 400 });
  }
  let endIso: string | null = null;
  if (arrivalWindow.end) {
    endIso = ukWallClockToUtcIso(isoDate, arrivalWindow.end);
    if (!endIso) {
      return NextResponse.json({ error: "arrival_time end did not parse to a valid timestamp." }, { status: 400 });
    }
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      return NextResponse.json({ error: "arrival_time end must be after start." }, { status: 400 });
    }
  }

  // ─── DB ──────────────────────────────────────────────────────────────
  const supabase = createServiceClient();

  // Idempotency: if a Zendesk ticket id was supplied and we already have a
  // job for it, return the existing row instead of duplicating.
  let convertingFromQuote: { id: string; clientId: string | null } | null = null;
  if (ticketId) {
    const { data: dupJob } = await supabase
      .from("jobs")
      .select("id, reference, status")
      .eq("external_source", "zendesk")
      .eq("external_ref", ticketId)
      .maybeSingle();
    if (dupJob) {
      return NextResponse.json(
        { id: dupJob.id, reference: dupJob.reference, status: dupJob.status, action: "existing" },
        { status: 200 },
      );
    }

    // Conversion path: a QUOTE for this ticket already exists (created by an
    // earlier Zendesk macro). Carry over its client_id and mark it converted
    // once the job is in.
    const { data: existingQuote } = await supabase
      .from("quotes")
      .select("id, client_id, status")
      .eq("external_source", "zendesk")
      .eq("external_ref", ticketId)
      .maybeSingle();
    if (existingQuote) {
      convertingFromQuote = {
        id:       existingQuote.id as string,
        clientId: (existingQuote.client_id as string | null) ?? null,
      };
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

  // Find or create a client in this account matching the email — unless we're
  // converting an existing quote, in which case we trust its linkage.
  let clientId: string | null = convertingFromQuote?.clientId ?? null;
  if (!clientId) {
    const { data: existing, error: findErr } = await supabase
      .from("clients")
      .select("id, phone")
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
      // Backfill phone when the existing client doesn't have one yet and the
      // caller now has a number. We never overwrite a phone that's already
      // there — staff may have curated it.
      const existingPhone = (existing as { phone: string | null }).phone;
      if (clientPhone && !existingPhone?.trim()) {
        const { error: phoneErr } = await supabase
          .from("clients")
          .update({ phone: clientPhone })
          .eq("id", clientId);
        if (phoneErr) {
          console.error("[api/jobs] client phone backfill failed:", phoneErr.message);
        }
      }
    } else {
      const { data: created, error: createErr } = await supabase
        .from("clients")
        .insert({
          full_name: clientName,
          email: clientEmail,
          phone: clientPhone,
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

  // ─── Hourly: resolve rates from Services catalog ────────────────────
  // For hourly jobs the rate is sourced from the Services catalog instead of
  // the payload. Resolution order for hourly_client_rate:
  //   1) explicit body.hourly_client_rate (caller override — still respected)
  //   2) account_service_prices.hourly_rate when use_standard = false
  //   3) service_catalog.hourly_rate (standard)
  // hourly_partner_rate falls back to the auto 40% margin when the caller
  // doesn't send one, so jobs default to a 40%-margin allocation and stay
  // unassigned (or auto_assigning) for staff/partners to pick up.
  let resolvedCatalogServiceId: string | null = null;
  let hourlyClientRate = hourlyClientRateIn;
  let hourlyPartnerRate = hourlyPartnerRateIn;
  if (rateType === "hourly") {
    const catalog = await resolveCatalogServiceForHourly(
      supabase,
      catalogServiceIdIn,
      serviceType,
    );
    if (!catalog.ok) {
      return NextResponse.json({ error: catalog.error }, { status: catalog.status });
    }
    resolvedCatalogServiceId = catalog.row.id;

    if (!hourlyClientRateSent) {
      const override = await fetchAccountServiceOverride(supabase, accountId, catalog.row.id);
      const resolved = resolveJobPricing({
        catalog: catalog.row,
        accountOverride: override,
        partnerOverride: null,
      });
      hourlyClientRate = Number(resolved.client.hourly_rate ?? 0);
    }
    if (!(hourlyClientRate > 0)) {
      return NextResponse.json(
        {
          error:
            "No hourly_client_rate available — set it on the account's Services pricing " +
            "(or include hourly_client_rate in the request).",
        },
        { status: 400 },
      );
    }
    if (!hourlyPartnerRateSet) {
      hourlyPartnerRate = autoMargin(hourlyClientRate);
    }
  }

  // ─── Partner matching (when auto_assign is on) ──────────────────────
  let matchedPartnerIds: string[] = [];
  if (autoAssign) {
    // Trade match + partner self-service prefs (excluded postcodes). Lead opt-in does not gate
    // direct job assignment (kind: "job").
    matchedPartnerIds = await matchPartnerIdsForWork(supabase, {
      serviceType,
      postcode: extractUkPostcode(propertyAddress),
      kind: "job",
    });
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
  // Margin sources differ by pricing mode. Fixed compares headline client_price
  // vs partner_cost; hourly compares the per-hour rates (totals scale linearly
  // so the percentage is the same).
  const margin = rateType === "hourly"
    ? (hourlyClientRate > 0 && hourlyPartnerRate > 0
        ? Math.round(((hourlyClientRate - hourlyPartnerRate) / hourlyClientRate) * 10000) / 100
        : 0)
    : (clientPrice > 0 && partnerCost > 0
        ? Math.round(((clientPrice - partnerCost) / clientPrice) * 10000) / 100
        : 0);

  const jobRow: Record<string, unknown> = {
    reference:          String(ref),
    title,
    client_id:          clientId,
    client_name:        clientName,
    property_address:   propertyAddress,
    service_type:       serviceType,
    status,
    client_price:       rateType === "hourly" ? 0 : clientPrice,
    partner_cost:       rateType === "hourly" ? 0 : partnerCost,
    materials_cost:     0,
    margin_percent:     margin,
    scheduled_date:     isoDate,
    scheduled_start_at: startIso,
    scheduled_end_at:   endIso,
    total_phases:       2,
    progress:           0,
    current_phase:      0,
    job_type:           rateType,
    finance_status:     "unpaid",
    scope:              description,
  };
  if (rateType === "hourly") {
    jobRow.hourly_client_rate  = hourlyClientRate;
    jobRow.hourly_partner_rate = hourlyPartnerRate;
    if (resolvedCatalogServiceId) {
      jobRow.catalog_service_id = resolvedCatalogServiceId;
    }
  }
  if (autoAssign && matchedPartnerIds.length > 0) {
    jobRow.auto_assign_invited_partner_ids = matchedPartnerIds;
  }
  if (ticketId) {
    jobRow.external_source = "zendesk";
    jobRow.external_ref    = ticketId;
  }
  if (convertingFromQuote) {
    jobRow.quote_id = convertingFromQuote.id;
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

  // Mark the source quote as converted (best-effort — the job is already in,
  // so don't fail the request if the status flip stumbles).
  if (convertingFromQuote) {
    const { error: convErr } = await supabase
      .from("quotes")
      .update({ status: "converted_to_job" })
      .eq("id", convertingFromQuote.id);
    if (convErr) {
      console.error("[api/jobs] quote conversion status update failed:", convErr.message);
    }
  }

  // ─── Zendesk dispatch (fire-and-forget; idempotent) ─────────────────
  // Sync ticket custom_status_id and post the customer-facing booking
  // confirmation + open the partner side conversation. The DB trigger
  // (mig 166/167) is the backup path — both call the same idempotent
  // helpers, so duplicate execution is safe.
  if (ticketId) {
    void Promise.all([
      syncJobZendeskStatus(inserted.id, supabase),
      dispatchJobCreatedZendesk({ jobId: inserted.id, client: supabase }),
    ]).catch((err) => {
      console.error("[api/jobs] Zendesk dispatch failed:", err);
    });
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
      action:    convertingFromQuote ? "converted_from_quote" : "created",
      ...(convertingFromQuote ? { from_quote_id: convertingFromQuote.id } : {}),
      ...(partnersNotified ? { partners_notified: partnersNotified } : {}),
    },
    { status: 201 },
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

type CatalogResolveResult =
  | { ok: true; row: CatalogService }
  | { ok: false; status: number; error: string };

/**
 * Resolve the service_catalog row for an hourly job. Prefers an explicit
 * catalog_service_id when the caller knows it; otherwise reuses the same
 * label→catalog matcher the in-app pickers use (exact name → normalized
 * type-of-work) so Zendesk macros can keep sending "deep_cleaning" /
 * "Cleaning" / "General Maintenance" without learning UUIDs.
 */
async function resolveCatalogServiceForHourly(
  supabase: SupabaseClient,
  catalogServiceIdIn: string | null,
  serviceType: string,
): Promise<CatalogResolveResult> {
  if (catalogServiceIdIn) {
    const { data, error } = await supabase
      .from("service_catalog")
      .select("id, name, pricing_mode, fixed_price, hourly_rate, default_hours, partner_cost")
      .eq("id", catalogServiceIdIn)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      console.error("[api/jobs] catalog lookup by id failed:", error.message);
      return { ok: false, status: 500, error: "Catalog lookup failed." };
    }
    if (!data) {
      return { ok: false, status: 400, error: "catalog_service_id not found." };
    }
    return { ok: true, row: data as CatalogService };
  }

  const { data: catalogRows, error: listErr } = await supabase
    .from("service_catalog")
    .select("id, name, pricing_mode, fixed_price, hourly_rate, default_hours, partner_cost")
    .eq("is_active", true)
    .is("deleted_at", null);
  if (listErr) {
    console.error("[api/jobs] catalog list failed:", listErr.message);
    return { ok: false, status: 500, error: "Catalog lookup failed." };
  }
  const rows = (catalogRows ?? []) as CatalogService[];
  const matchedId = catalogServiceIdForTypeOfWorkLabel(serviceType, rows);
  if (!matchedId) {
    return {
      ok: false,
      status: 400,
      error:
        `service_type "${serviceType}" did not match any active Services catalog ` +
        `entry. Send catalog_service_id explicitly or use one of the canonical type ` +
        `names (e.g. "Cleaning", "Plumber", "Electrician", "General Maintenance").`,
    };
  }
  const row = rows.find((r) => r.id === matchedId);
  if (!row) {
    return { ok: false, status: 500, error: "Catalog matcher returned a stale id." };
  }
  return { ok: true, row };
}

async function fetchAccountServiceOverride(
  supabase: SupabaseClient,
  accountId: string,
  catalogServiceId: string,
): Promise<AccountServicePrice | null> {
  const { data, error } = await supabase
    .from("account_service_prices")
    .select("id, account_id, catalog_service_id, use_standard, fixed_price, hourly_rate, default_hours")
    .eq("account_id", accountId)
    .eq("catalog_service_id", catalogServiceId)
    .maybeSingle();
  if (error) {
    console.error("[api/jobs] account override lookup failed:", error.message);
    return null;
  }
  return (data as AccountServicePrice | null) ?? null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Partner side of the standard margin: round(clientSide * 0.60, 2). */
function autoMargin(clientSide: number): number {
  return Math.round(clientSide * (100 - AUTO_PARTNER_MARGIN_PCT)) / 100;
}

/** Was the field included in the request? Empty strings count as "not sent". */
function isPresent(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  return true;
}

/**
 * Coerce a money-ish value (number or string) into a finite number.
 *
 * Tolerates the shapes a Zendesk macro / spreadsheet template tends to
 * produce: a currency prefix (£/$/€), whitespace, and UK/EU number
 * formatting ("1,234.50" thousands separator, or "177,60" with a comma
 * as decimal point). Returns 0 for anything we can't make sense of.
 */
function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v !== "string") return 0;
  let s = v.trim().replace(/[£$€\s]/g, "");
  if (!s) return 0;
  if (s.includes(",") && s.includes(".")) {
    // "1,234.50" — comma is the thousands separator.
    s = s.replace(/,/g, "");
  } else if (s.includes(",")) {
    // "177,60" — comma is the decimal point.
    s = s.replace(/,/g, ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Slot id → (start, end) UK wall-clock map. Mirrors ARRIVAL_SLOTS in
 * lib/job-arrival-window.ts. We keep a local copy so the API can also accept
 * the Zendesk macro tags (e.g. `arrival_morning`, `arrival_late_afternoon`)
 * without needing the partner-app dependency tree.
 */
const ARRIVAL_SLOT_LOOKUP: Record<string, { start: string; end: string }> = {
  earlier_morning:      { start: "08:00", end: "09:00" },
  morning:              { start: "09:00", end: "12:00" },
  early_afternoon:      { start: "13:00", end: "15:00" },
  // Zendesk uses `late_afternoon`; internal slot id is just `afternoon`.
  // Accept both spellings so either side stays valid.
  afternoon:            { start: "15:00", end: "18:00" },
  late_afternoon:       { start: "15:00", end: "18:00" },
  evening:              { start: "18:00", end: "20:00" },
};

/**
 * Parse an arrival_time payload into UK wall-clock HH:MM start (and optional
 * end). Accepts:
 *   "09:00 - 12:00"      → { start: "09:00", end: "12:00" }   ASCII hyphen
 *   "09:00 – 12:00"      → same   (en-dash, what Zendesk renders by default)
 *   "09:00 — 12:00"      → same   (em-dash)
 *   "09:00-12:00"        → same   (dashes/spaces flex)
 *   "9:00 - 12:00"       → start padded to "09:00"
 *   "09:00"              → { start: "09:00", end: null } — no window
 *   "morning"            → catalog slot lookup → 09:00 / 12:00
 *   "arrival_morning"    → same — Zendesk macro tag prefix is tolerated
 *   "early_afternoon" / "afternoon" / "late_afternoon" / "evening" → likewise
 * Returns null when the shape doesn't match or hours/minutes are out of range.
 */
function parseArrivalTime(input: string): { start: string; end: string | null } | null {
  const raw = input.trim();
  if (!raw) return null;

  // Slot id / Zendesk tag path — try the lookup before regex so callers can
  // ship the macro tag straight through. Strip a leading `arrival_` if the
  // value came from Zendesk's tag form.
  const slotKey = raw.toLowerCase().replace(/^arrival[_-]/, "");
  if (ARRIVAL_SLOT_LOOKUP[slotKey]) {
    return { ...ARRIVAL_SLOT_LOOKUP[slotKey] };
  }

  // Normalize any dash character (en-dash U+2013, em-dash U+2014, minus sign
  // U+2212, hyphen-minus, etc.) to a plain ASCII hyphen so one regex covers
  // every dash flavor that copy-paste / Zendesk might produce.
  const s = raw.replace(/[‐-―−]/g, "-");
  const m = s.match(/^(\d{1,2}):(\d{2})(?:\s*-\s*(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const start = padHm(m[1], m[2]);
  if (!start) return null;
  if (m[3] === undefined) return { start, end: null };
  const end = padHm(m[3], m[4]);
  if (!end) return null;
  return { start, end };
}

function padHm(hh: string, mm: string): string | null {
  const h = Number(hh);
  const mi = Number(mm);
  if (!Number.isInteger(h) || !Number.isInteger(mi)) return null;
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
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
