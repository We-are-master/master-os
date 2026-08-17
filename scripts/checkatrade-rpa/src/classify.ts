import type { Page } from "playwright";
import type { RpaConfig } from "./config.js";
import type { CheckatradeOpportunity } from "./checkatrade/types.js";
import { acceptJobAndPickSlot, detailUrl } from "./checkatrade/booking.js";
import { respondToLead } from "./checkatrade/leadResponse.js";
import { type MasterOsClient } from "./masterOs/client.js";
import { countJobsAcceptedToday, hasSeen, markSeen } from "./dedupe/seenStore.js";
import { logger } from "./logger.js";

// service_type is ALWAYS cfg.fallbackCategory ("General Maintenance") — it's
// the single trade we operate on Checkatrade, and it's a canonical catalog
// name so the OS never rejects it. Jobs still show the specific Checkatrade
// title via CreateJobPayload.title.

/**
 * Pre-accept gate for a JOB (Checkatrade Express) — evaluated from the list
 * card alone (no page load), before we ever navigate to the accept flow.
 * Leads are never filtered here (they're a separate, non-financial path).
 * The keyword gate is the main "don't grab everything" control: JOB_KEYWORDS
 * must appear in the job title/description, or the job is skipped. Date/slot
 * rules are enforced later, in booking.ts, once the calendar is visible.
 */
function jobPassesPreFilters(
  o: CheckatradeOpportunity,
  cfg: RpaConfig,
): { ok: true } | { ok: false; reason: string } {
  const keywords = cfg.jobFilters.keywords;
  if (keywords.length > 0) {
    const haystack = `${o.category} ${o.description ?? ""}`.toLowerCase();
    if (!keywords.some((k) => haystack.includes(k))) {
      return { ok: false, reason: `no keyword match (title="${o.category}")` };
    }
  }

  if (cfg.jobFilters.minValue > 0 && (o.priceHint ?? 0) < cfg.jobFilters.minValue) {
    return { ok: false, reason: `value £${o.priceHint ?? 0} < min £${cfg.jobFilters.minValue}` };
  }

  // Postcode blocklist — always on, independent of the optional allowlist
  // below. RM (Romford) came off the map on 17/08/2026 by owner decision.
  if (o.postcode) {
    const pc = o.postcode.trim().toLowerCase();
    const bloqueada = cfg.jobFilters.blockedRegions.find((r) => pc.startsWith(r));
    if (bloqueada) {
      return { ok: false, reason: `postcode ${o.postcode} is in blocked region ${bloqueada.toUpperCase()}` };
    }
  }

  // Optional extra allowlists from config.json (off by default).
  if (cfg.filters.enabled) {
    const { categories, regions } = cfg.filters;
    if (categories.length > 0 && !categories.some((c) => c.toLowerCase() === o.category.toLowerCase())) {
      return { ok: false, reason: `category "${o.category}" not in allowlist` };
    }
    if (
      regions.length > 0 &&
      o.postcode &&
      !regions.some((r) => o.postcode!.toUpperCase().startsWith(r.toUpperCase()))
    ) {
      return { ok: false, reason: `region ${o.postcode} not in allowlist` };
    }
  }

  return { ok: true };
}

export async function handleOpportunity(
  o: CheckatradeOpportunity,
  page: Page,
  cfg: RpaConfig,
  masterOs: MasterOsClient,
): Promise<void> {
  if (await hasSeen(o.externalId)) return;

  // Controlled-test knob (config.json's processKinds) — restrict which
  // kind(s) this run acts on, e.g. ["lead"] to verify the lead path alone
  // without risking a real, financially-binding job acceptance. Not marked
  // seen: once the restriction is lifted, a still-New opportunity should be
  // reconsidered rather than silently skipped forever.
  if (!cfg.processKinds.includes(o.kind)) return;

  try {
    if (o.kind === "lead") {
      await handleLead(o, page, cfg, masterOs);
      return;
    }
    await handleJob(o, page, cfg, masterOs);
  } catch (err) {
    // Don't mark as seen on failure — retry next cycle. Don't rethrow — one
    // bad opportunity must not kill the rest of the poll cycle.
    logger.error(`Failed to process opportunity ${o.externalId}`, err);
  }
}

async function handleLead(
  o: CheckatradeOpportunity,
  page: Page,
  cfg: RpaConfig,
  masterOs: MasterOsClient,
): Promise<void> {
  // Click through to the lead's detail page and mark "I'm interested" first —
  // non-financial (unlike accepting a job), but it's the real "respond"
  // action Checkatrade expects, and it reveals phone/email plus the full
  // original enquiry message (richer than the list card's preview).
  const details = await respondToLead(page, o);
  const leadPayload = {
    name: o.customerName || "Checkatrade lead",
    address: o.address || "",
    postcode: o.postcode,
    phone: details.phone,
    email: details.email,
    scope: [details.message ?? o.description, details.appointmentNote].filter(Boolean).join("\n\n"),
    service_type: cfg.fallbackCategory,
  };
  const res = await masterOs.createLead(leadPayload);
  await markSeen(o.externalId, { kind: "lead", masterOsId: res.id });
  logger.info("Created lead in Master OS", { externalId: o.externalId, reference: res.reference });
}

async function handleJob(
  o: CheckatradeOpportunity,
  page: Page,
  cfg: RpaConfig,
  masterOs: MasterOsClient,
): Promise<void> {
  // 1. Cheap list-card gate: keyword / value / allowlists. Skip (and remember)
  //    anything that doesn't match so we don't re-evaluate it every cycle.
  const pre = jobPassesPreFilters(o, cfg);
  if (!pre.ok) {
    logger.info(`Skip job ${o.externalId} "${o.category}": ${pre.reason}`);
    await markSeen(o.externalId, { kind: "job", masterOsId: "" });
    return;
  }

  // 2. Daily cap (MAX_JOBS_PER_DAY, 0 = unlimited). Don't mark seen — a capped
  //    job should be reconsidered tomorrow if it's still live.
  if (cfg.acceptance.maxJobsPerDay > 0) {
    const acceptedToday = await countJobsAcceptedToday(cfg.schedule.timezone);
    if (acceptedToday >= cfg.acceptance.maxJobsPerDay) {
      logger.warn(`Daily cap reached (${acceptedToday}/${cfg.acceptance.maxJobsPerDay}); not accepting ${o.externalId} now`);
      return;
    }
  }

  // 3. Open the accept flow, enforce the date/slot-day rules, and (only when
  //    auto-accept is on and a valid slot exists) actually accept — a real,
  //    financially-binding action — BEFORE recording anything in Master OS.
  const outcome = await acceptJobAndPickSlot(page, o, {
    strategy: cfg.booking.slotSelectionStrategy,
    autoAccept: cfg.acceptance.autoAccept,
    minDateDaysAhead: cfg.jobFilters.minDateDaysAhead,
    slotDays: cfg.jobFilters.slotDays,
    timezone: cfg.schedule.timezone,
  });

  if (outcome.status === "no_valid_slot") {
    logger.info(`Skip job ${o.externalId} "${o.category}": ${outcome.reason}`);
    await markSeen(o.externalId, { kind: "job", masterOsId: "" });
    return;
  }

  if (outcome.status === "would_accept") {
    logger.info(
      `MATCH (AUTO_ACCEPT off) job ${o.externalId} "${o.category}" — valid slot ${outcome.date} ${outcome.timeWindow ?? ""}; not accepting`,
    );
    await markSeen(o.externalId, { kind: "job", masterOsId: "" });
    return;
  }

  const accepted = outcome.slot;
  // Checkatrade only reveals a postcode, never a full street address before
  // acceptance; even after, the visible text is postcode-only — the full
  // address comes from the "Open in Google Maps" link (scrapeRevealedAddress).
  // Send whatever we resolved; Master OS geocodes property_address (Mapbox).
  const propertyAddress = accepted.fullAddress || o.address || o.postcode || "";
  const title = o.category;
  const clientName = accepted.customerName || o.customerName || "Checkatrade customer";
  const checkatradeLink = detailUrl(o.externalId);

  const jobPayload = {
    account_id: cfg.masterOs.accountId,
    date: accepted.acceptedDate,
    arrival_time: accepted.acceptedTimeWindow ?? "09:00",
    client_name: clientName,
    property_address: propertyAddress,
    postcode: o.postcode,
    // Specific Checkatrade title for display (jobs.title) — separate from
    // service_type, which must be a broad trade for partner matching.
    title,
    service_type: cfg.fallbackCategory,
    // The real, job-specific brief lives on the detail page, not the list card.
    description: accepted.richDescription || o.description,
    client_price: o.priceHint,
    auto_assign: true as const,
    report_link: checkatradeLink,
    // The OS opens + links the Zendesk ticket itself at insert time — 100%
    // linked from birth, no RPA-side Zendesk calls to race or half-fail.
    create_zendesk_ticket: true as const,
  };
  const res = await masterOs.createJob(jobPayload);
  await markSeen(o.externalId, { kind: "job", masterOsId: res.id });
  logger.info("Created job in Master OS", {
    externalId: o.externalId,
    reference: res.reference,
    zendeskTicketId: res.zendesk_ticket_id ?? "(none — check OS logs)",
  });
}
