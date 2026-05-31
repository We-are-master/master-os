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
import { parseFrontendSetup } from "@/lib/frontend-setup";
import type {
  AccountServicePrice,
  CatalogService,
} from "@/types/database";
import { dispatchAutoAssignJobInvites } from "@/lib/auto-assign-job-invites";

/** Final fallback margin when company_settings.frontend_setup is unreadable. */
const AUTO_PARTNER_MARGIN_PCT_FALLBACK = 40;

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

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
 *     title?:           string,      // optional. When omitted, falls back to
 *                                    //   service_type so Zendesk macros that
 *                                    //   only carry the trade label can post
 *                                    //   without padding a separate title.
 *     client_name:      string,      // required
 *     client_email?:    string,      // optional. Placeholder strings the
 *                                    //   Zendesk macro emits when the field
 *                                    //   is blank ("", "0", "A", "n/a", "-")
 *                                    //   are normalised to null. When null,
 *                                    //   the client lookup falls back to
 *                                    //   matching by client_name in the same
 *                                    //   account.
 *     client_phone?:    string,      // optional contact phone. Same
 *                                    //   placeholder normalisation as
 *                                    //   client_email. On creation it lands
 *                                    //   on clients.phone. When the client
 *                                    //   already exists with an empty phone,
 *                                    //   this value backfills it; a non-empty
 *                                    //   phone is never overwritten.
 *     property_address: string,      // required (geocoded by app for partner map)
 *     service_type?:    string,      // trade label. Optional when
 *                                    //   catalog_service_id is sent — the
 *                                    //   catalog row's `name` is used instead.
 *                                    //   Required when no catalog_service_id
 *                                    //   is provided. Used at runtime for
 *                                    //   partner matching (matchPartnerIdsForWork)
 *                                    //   and, for hourly jobs, to look up the
 *                                    //   service_catalog row. NOT persisted on
 *                                    //   the jobs row directly — the trade
 *                                    //   label lives on jobs.title and the
 *                                    //   catalog linkage on jobs.catalog_service_id.
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
 *     catalog_service_id?: string,   // optional UUID of the service_catalog
 *                                    //   row. When sent, the row's `name` is
 *                                    //   pulled and used as service_type /
 *                                    //   title, so the macro can send the id
 *                                    //   alone without duplicating the label.
 *                                    //   For hourly jobs, the row is also the
 *                                    //   anchor for the rate resolver. When
 *                                    //   omitted on hourly, the API matches
 *                                    //   service_type to the catalog by exact
 *                                    //   name → normalized canonical type-of-work
 *                                    //   (must be unambiguous).
 *     client_price?:    number|str,  // [fixed] £ charged to the client (default 0).
 *                                    //   Strings like "£177.60" / "177,60" /
 *                                    //   "1,234.50" are accepted — currency,
 *                                    //   spaces and UK/EU number formatting
 *                                    //   get normalized.
 *     partner_cost?:    number|str,  // [fixed] £ paid to the partner. When
 *                                    //   OMITTED and client_price > 0, defaults
 *                                    //   to round(client_price * (1 - target/100), 2)
 *                                    //   using the company margin target from
 *                                    //   Settings → Setup (40% if unset). Send
 *                                    //   an explicit 0 to opt out.
 *     hourly_client_rate?: number|str,    // [hourly] £/h charged to the
 *                                    //   client. Optional — when omitted OR
 *                                    //   sent as 0, the API resolves it from
 *                                    //   account_service_prices (override) or
 *                                    //   service_catalog (standard). Treating
 *                                    //   0 the same as missing lets Zendesk
 *                                    //   macros leave the rate field blank
 *                                    //   without needing to know the account
 *                                    //   pricing in advance. Must end up > 0
 *                                    //   from one of those sources, else 400.
 *     hourly_partner_rate?: number|str,   // [hourly] £/h paid to the partner.
 *                                    //   Optional — when omitted OR sent as 0,
 *                                    //   the API resolves from the
 *                                    //   service_catalog standard
 *                                    //   (partner_cost / default_hours). When
 *                                    //   the catalog row has no partner_cost
 *                                    //   configured, falls back to the company
 *                                    //   margin target × hourly_client_rate
 *                                    //   (40% if unset).
 *     auto_assign?:     boolean,     // when true → status='auto_assigning'
 *                                    //   + push notify partners matching service_type
 *                                    //   via the existing offer-window mechanism
 *                                    //   (mig 080). Default false → status='unassigned',
 *                                    //   staff picks partner manually.
 *     ticket_id?:       string,      // Zendesk ticket id — stored as
 *                                    //   external_source='zendesk',
 *                                    //   external_ref=ticket_id.
 *                                    //   Re-posting the same id returns the
 *                                    //   existing job (idempotent).
 *                                    //   If a QUOTE already exists with this
 *                                    //   ticket_id (e.g. created by an earlier
 *                                    //   Zendesk macro), the job is created
 *                                    //   linked to it (jobs.quote_id) and the
 *                                    //   quote is marked status='converted_to_job'.
 *     report_link?:     string       // Free-text URL where the office submits
 *                                    //   the customer-side report (Drive
 *                                    //   folder, Notion page, internal portal,
 *                                    //   etc). Persisted on jobs.report_link
 *                                    //   and echoed back in the response so
 *                                    //   the macro can confirm. Distinct from
 *                                    //   the partner-app submission URL the
 *                                    //   API builds on the fly.
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
 *   - When partner_cost (fixed) is missing and client_price > 0, applies
 *     the company margin target from Settings → Setup (40% if unset):
 *     partner_cost = round(client_price * (1 - target/100), 2).
 *   - When hourly_partner_rate is missing, the partner side comes from
 *     service_catalog (partner_cost / default_hours) when configured; the
 *     same margin target × hourly_client_rate is used as the last-resort
 *     fallback if the catalog row has no partner amount yet.
 *   - When auto_assign=true: matches active partners by service_type
 *     (using the same partnerMatchesTypeOfWork rules the Desk webhook
 *     uses), stores their ids in auto_assign_invited_partner_ids, and
 *     sends an Expo push. Falls back to status='unassigned' if no
 *     partner matched.
 *
 * Response: 201 { id, reference, status, report_link, partners_notified? }
 *
 *   - report_link: echoes the value supplied in the request when present
 *     (persisted on jobs.report_link). When the caller didn't send one,
 *     falls back to the bare partner-app URL
 *     `${partnerAppBase}/jobs/{reference}/report` so the response always
 *     carries a usable link. Returned on both `created` and `existing`
 *     (idempotent re-post) responses; on `existing` the persisted value
 *     wins so the link the office set originally always comes back.
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
  // Free-text contact fields tolerate the placeholders a Zendesk macro emits
  // when the corresponding ticket field is left blank ("", "0", "A", "n/a"…).
  // We normalise to null so the OS row stays clean and the email lookup
  // doesn't ilike against junk strings.
  const clientEmailRaw  = nullish(body.client_email)?.toLowerCase() ?? null;
  const clientEmail     = clientEmailRaw && clientEmailRaw.includes("@") ? clientEmailRaw : null;
  const clientPhone     = nullish(body.client_phone);
  const propertyAddress = str(body.property_address);
  // `let` because the catalog name can override this when the caller pinned a
  // catalog_service_id without sending a separate service_type.
  let serviceType       = str(body.service_type);
  const description     = str(body.description) || null;
  // Accept either the bare value (`hourly` / `fixed`) or the Zendesk Job Type
  // field tag form (`job_type_hourly` / `job_type_fixed`) — the prefix is
  // stripped so the macro can post the tag straight through.
  const rateType        = (
    str(body.rate_type).toLowerCase().replace(/^job[_-]type[_-]/, "") || "fixed"
  ) as "fixed" | "hourly";
  // `let` because we drop the value to service_type below when it isn't a UUID
  // (typically a Zendesk ticket saved before the slug→UUID backfill).
  let catalogServiceIdIn = str(body.catalog_service_id) || null;
  const autoAssign      = body.auto_assign === true || /^true$/i.test(str(body.auto_assign));
  const ticketId        = str(body.ticket_id) || null;
  const reportLinkIn    = nullish(body.report_link);

  // Distinguish "omitted" from "explicit 0" so we can auto-apply the company
  // margin target when the caller didn't send a partner-side amount. The
  // target percentage itself is loaded from company_settings.frontend_setup
  // below (after the supabase client is initialised), so the actual partner
  // figures are computed further down.
  // The two pricing modes use different columns:
  //   fixed  → client_price / partner_cost
  //   hourly → hourly_client_rate / hourly_partner_rate
  const clientPrice          = num(body.client_price);
  const partnerCostSent      = isPresent(body.partner_cost);
  const partnerCostIn        = partnerCostSent ? num(body.partner_cost) : 0;
  // For hourly: the body values act as caller overrides; when omitted (or
  // explicitly 0, which a Zendesk macro will send when the rate field on the
  // ticket is left blank), rates are resolved from the Services catalog
  // (account override → standard) and the partner rate falls back to the
  // service_catalog standard (with the company margin target as last resort).
  // Treating 0 the same as missing means the macro never needs to know the
  // account's pricing in advance.
  const hourlyClientRateIn   = num(body.hourly_client_rate);
  const hourlyClientRateSent = isPresent(body.hourly_client_rate) && hourlyClientRateIn > 0;
  const hourlyPartnerRateIn  = num(body.hourly_partner_rate);
  const hourlyPartnerRateSet = isPresent(body.hourly_partner_rate) && hourlyPartnerRateIn > 0;

  // ─── Validation ──────────────────────────────────────────────────────
  // client_email / client_phone are optional — Zendesk forms often leave one
  // blank and the macro shouldn't 400 just because of that.
  if (
    !accountId || !date || !arrivalTime ||
    !clientName || !propertyAddress ||
    (!serviceType && !catalogServiceIdIn)
  ) {
    return NextResponse.json(
      {
        error:
          "account_id, date, arrival_time, client_name, property_address, " +
          "and either service_type or catalog_service_id are required.",
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
    // Webhook is feeding us a Type of Work field value that's still the
    // pre-backfill slug (`deep_cleaning`, `fire_alarm_service`, …) rather
    // than the OS UUID. Treat it as a service_type label so the slug-aware
    // matcher can resolve it, instead of failing the request.
    if (!serviceType) serviceType = catalogServiceIdIn;
    catalogServiceIdIn = null;
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

  // Margin target — the company-wide percentage staff configured in
  // Settings → Setup → Margin Targets. Drives both the fixed-mode partner
  // cost auto-default and the hourly partner-rate fallback (when the catalog
  // row has no standard partner amount). Falls back to 40% if the row can't
  // be read so a transient DB hiccup doesn't break job creation.
  const { data: companyRow } = await supabase
    .from("company_settings")
    .select("frontend_setup")
    .limit(1)
    .maybeSingle();
  const targetMarginPct = parseFrontendSetup(
    (companyRow as { frontend_setup?: unknown } | null)?.frontend_setup ?? null,
  ).target_margin_pct ?? AUTO_PARTNER_MARGIN_PCT_FALLBACK;

  // Now that we know the target margin, finalise the fixed-mode partner cost.
  // An explicit value from the body still wins; otherwise the auto-margin
  // default kicks in only when there's a positive client price to apply it to.
  const partnerCost = partnerCostSent
    ? partnerCostIn
    : clientPrice > 0
      ? autoMargin(clientPrice, targetMarginPct)
      : 0;

  // When the caller pinned a catalog_service_id, treat the catalog row's name
  // as the trade label. The macro's mental model is "catalog id IS the type of
  // work" — there's no separate service_type to send. The resolved name is
  // also used as the title fallback (jobs.title) and for partner matching
  // downstream, so everything lines up with what the Services catalog has.
  if (catalogServiceIdIn) {
    const { data: catRow, error: catErr } = await supabase
      .from("service_catalog")
      .select("name")
      .eq("id", catalogServiceIdIn)
      .is("deleted_at", null)
      .maybeSingle();
    if (catErr) {
      console.error("[api/jobs] catalog name lookup failed:", catErr.message);
      return NextResponse.json({ error: "Catalog lookup failed." }, { status: 500 });
    }
    if (!catRow) {
      return NextResponse.json({ error: "catalog_service_id not found." }, { status: 400 });
    }
    serviceType = String((catRow as { name: string }).name).trim();
  }

  // service_type doubles as title when the caller doesn't supply one. The jobs
  // table has a `title` column, no `service_type` column — the trade label is
  // stored there and also used at runtime for partner matching / catalog lookup.
  const titleResolved = title || serviceType;

  // Idempotency: if a Zendesk ticket id was supplied and we already have a
  // job for it, return the existing row instead of duplicating.
  let convertingFromQuote: { id: string; clientId: string | null } | null = null;
  if (ticketId) {
    const { data: dupJob } = await supabase
      .from("jobs")
      .select("id, reference, status, report_link")
      .eq("external_source", "zendesk")
      .eq("external_ref", ticketId)
      .maybeSingle();
    if (dupJob) {
      const dup = dupJob as {
        id: string;
        reference: string;
        status: string;
        report_link: string | null;
      };
      return NextResponse.json(
        {
          id:         dup.id,
          reference:  dup.reference,
          status:     dup.status,
          action:     "existing",
          report_link: dup.report_link ?? buildReportLink(String(dup.reference)),
        },
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

  // Find or create a client in this account — unless we're converting an
  // existing quote, in which case we trust its linkage.
  //
  // Lookup strategy:
  //   - When client_email is present, match on email (unique-ish across the
  //     account, case-insensitive).
  //   - Otherwise fall back to matching on full_name in the same account.
  //     Duplicates with the same name are possible but acceptable — the
  //     caller chose to omit the email, and creating a fresh row each time
  //     would silently fragment history worse than reusing a name match.
  let clientId: string | null = convertingFromQuote?.clientId ?? null;
  if (!clientId) {
    const baseQuery = supabase
      .from("clients")
      .select("id, phone")
      .eq("source_account_id", accountId)
      .limit(1);
    const { data: existing, error: findErr } = clientEmail
      ? await baseQuery.ilike("email", clientEmail).maybeSingle()
      : await baseQuery.ilike("full_name", clientName).maybeSingle();
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
  // Resolution order for hourly_partner_rate when the caller doesn't send
  // one (or sends 0):
  //   1) service_catalog.partner_cost / default_hours (what staff captured)
  //   2) company margin target × hourly_client_rate (Settings → Setup)
  // Jobs land allocated either way and stay unassigned (or auto_assigning)
  // for staff/partners to pick up.
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
      // Partner side: prefer the service_catalog standard (where staff already
      // captured what we pay) over a generic margin formula. Catalog stores
      // partner_cost as the total for `default_hours` of work, so divide.
      // When the catalog has no partner_cost configured for this trade, fall
      // back to the company margin target — same lever fixed-mode uses.
      const catRow = catalog.row;
      const catPartnerCost = catRow.partner_cost != null ? Number(catRow.partner_cost) : 0;
      const hours = catRow.default_hours && Number(catRow.default_hours) > 0
        ? Number(catRow.default_hours)
        : 1;
      const fromCatalog = catPartnerCost > 0
        ? Math.round((catPartnerCost / hours) * 100) / 100
        : 0;
      hourlyPartnerRate = fromCatalog > 0
        ? fromCatalog
        : autoMargin(hourlyClientRate, targetMarginPct);
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
    title:              titleResolved,
    client_id:          clientId,
    client_name:        clientName,
    property_address:   propertyAddress,
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
  if (reportLinkIn) {
    jobRow.report_link = reportLinkIn;
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

  // ─── Auto-assign invites (push + Zendesk Email 1 when ticket linked) ─
  let partnersNotified: { sent: number; tokensFound: number } | undefined;
  if (autoAssign && matchedPartnerIds.length > 0) {
    try {
      const { pushSent } = await dispatchAutoAssignJobInvites({
        supabase,
        jobId: String(inserted.id),
        jobReference: String(inserted.reference),
        jobTitle: titleResolved,
        clientName,
        propertyAddress,
        scope: description || "(no scope provided)",
        scheduledDate: isoDate,
        partnerIds: matchedPartnerIds,
        zendeskTicketId: ticketId,
      });
      partnersNotified = { sent: pushSent, tokensFound: pushSent };
    } catch (err) {
      console.error("[api/jobs] auto-assign invites failed:", err);
      partnersNotified = { sent: 0, tokensFound: 0 };
    }
  }

  return NextResponse.json(
    {
      id:          inserted.id,
      reference:   inserted.reference,
      status:      inserted.status,
      action:      convertingFromQuote ? "converted_from_quote" : "created",
      report_link: reportLinkIn ?? buildReportLink(String(inserted.reference)),
      ...(convertingFromQuote ? { from_quote_id: convertingFromQuote.id } : {}),
      ...(partnersNotified ? { partners_notified: partnersNotified } : {}),
    },
    { status: 201 },
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Partner app URL for the job report submission page. Same shape the Zoho
 * Desk webhook and partner email use (`${partnerAppBase}/jobs/{reference}/report`)
 * so anything carrying this link — Zendesk macros, partner emails, n8n
 * forwards — resolves to the same destination. Bare URL with no token:
 * the partner needs to be logged in to the partner app to view the report.
 */
function buildReportLink(reference: string): string {
  const base = process.env.NEXT_PUBLIC_PARTNER_APP_URL?.trim().replace(/\/$/, "")
    || "https://app.getfixfy.com";
  return `${base}/jobs/${reference}/report`;
}

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
  const matchedId =
    catalogServiceIdForTypeOfWorkLabel(serviceType, rows) ??
    matchCatalogBySlug(serviceType, rows);
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

/**
 * Slug-aware fallback matcher. Zendesk macros and other integrations often
 * carry the trade as a snake_case slug (`deep_cleaning`, `fire_alarm_service`,
 * `pat_testing`) rather than a canonical display name. The label matcher in
 * `catalogServiceIdForTypeOfWorkLabel` looks at the catalog's `name` column,
 * where rows are stored with bracket prefixes ("(DC) Deep Cleaning") — so a
 * direct text match misses.
 *
 * This fallback slugifies the input and the catalog names (both the full
 * name and the base name with bracket prefix / trailing duplicate stripped)
 * and looks for a single confident match. Returns null when zero or multiple
 * candidates match — better to surface a 400 than to silently relink to the
 * wrong row.
 */
function matchCatalogBySlug(
  input: string,
  catalog: { id: string; name: string }[],
): string | null {
  const slug = slugify(input);
  if (!slug) return null;

  const exact = catalog.filter((c) => {
    const full = slugify(c.name);
    const base = slugify(stripBracketDecor(c.name));
    return full === slug || base === slug;
  });
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return null;

  // Loose containment between slug forms — catches `end_of_tenancy_cleaning`
  // ↔ `end_of_tenancy`, but only when exactly one catalog candidate matches.
  const loose = catalog.filter((c) => {
    const base = slugify(stripBracketDecor(c.name));
    return base && (base.includes(slug) || slug.includes(base));
  });
  return loose.length === 1 ? loose[0].id : null;
}

function slugify(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Strip a leading `(XXX)` initialism and a trailing `(XXX)` duplicate. */
function stripBracketDecor(s: string): string {
  return s
    .replace(/^\s*\([^)]+\)\s*/, "")
    .replace(/\s*\([^)]+\)\s*$/, "")
    .trim();
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

/**
 * Partner side of the company margin target. With targetPct = 40 returns
 * round(clientSide * 0.60, 2) — but the caller passes the value from
 * Settings → Setup, so it always reflects current configuration.
 */
function autoMargin(clientSide: number, targetPct: number): number {
  const clamped = Math.max(0, Math.min(100, targetPct));
  return Math.round(clientSide * (100 - clamped)) / 100;
}

/** Was the field included in the request? Empty strings count as "not sent". */
function isPresent(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  return true;
}

/**
 * Free-text input → null when the caller is just rendering a blank Zendesk
 * field. Treats empty / whitespace / "0" / "A" / "a" / "n/a" / "-" / "—" as
 * unset so contact fields and the report_link stay clean instead of carrying
 * meaningless placeholders.
 */
function nullish(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const norm = s.toLowerCase();
  if (norm === "0" || norm === "a" || norm === "n/a" || norm === "-" || norm === "—") {
    return null;
  }
  return s;
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
