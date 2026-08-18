import type { Page } from "playwright";
import type { RpaConfig } from "./config.js";
import type { CheckatradeOpportunity } from "./checkatrade/types.js";
import { acceptJobAndPickSlot, detailUrl } from "./checkatrade/booking.js";
import { respondToLead } from "./checkatrade/leadResponse.js";
import { type MasterOsClient } from "./masterOs/client.js";
import { countJobsAcceptedToday, hasSeen, markSeen } from "./dedupe/seenStore.js";
import { logger } from "./logger.js";
import { tipoDeTrabalho } from "./jobRules.js";

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
  const haystack = `${o.category} ${o.description ?? ""}`.toLowerCase();

  // Blocklist first — a trade we've stopped doing (e.g. garden work) must be
  // rejected no matter how well it scores on price or keywords.
  const blocked = cfg.jobFilters.excludeKeywords.find((k) => haystack.includes(k));
  if (blocked) {
    return { ok: false, reason: `excluded keyword "${blocked}" (title="${o.category}")` };
  }

  const keywords = cfg.jobFilters.keywords;
  if (keywords.length > 0 && !keywords.some((k) => haystack.includes(k))) {
    return { ok: false, reason: `no keyword match (title="${o.category}")` };
  }

  // A missing price is NOT a cheap job — it's a scrape failure (the card's
  // "Earnings £X" leaf moved or didn't render). Say so loudly rather than
  // burying it in a routine skip line.
  if (o.priceHint == null) {
    return { ok: false, reason: `NO PRICE PARSED from card (title="${o.category}") — check the card selectors` };
  }

  // A blanket floor, when set. Left at 0 by default: worth-taking is decided
  // per service by jobRules on the DETAIL page, because the card can't tell a
  // day booking from a one-off task. This stays as a coarse emergency brake.
  if (cfg.jobFilters.minValue > 0 && o.priceHint < cfg.jobFilters.minValue) {
    return { ok: false, reason: `value £${o.priceHint} < min £${cfg.jobFilters.minValue}` };
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
    external_id: o.externalId,
    name: o.customerName || "Unnamed customer",
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

  // 3. Refuse to accept into a dead Master OS. The accept below is REAL money
  //    and happens BEFORE the OS write, so a destination that's down produces
  //    a job we're committed to and have no record of — unrecoverable. The job
  //    is left on the board and NOT marked seen, so the next cycle retries it
  //    once the OS is back.
  if (cfg.acceptance.autoAccept) {
    const health = await masterOs.preflight();
    if (!health.ok) {
      logger.error(
        `NOT accepting ${o.externalId} "${o.category}" — Master OS ${health.detail}. ` +
          `Accepting is irreversible, so the job stays on the board for the next cycle.`,
      );
      return;
    }
  }

  // 4. Open the accept flow, enforce the date/slot-day rules, and (only when
  //    auto-accept is on and a valid slot exists) actually accept — a real,
  //    financially-binding action — BEFORE recording anything in Master OS.
  const outcome = await acceptJobAndPickSlot(page, o, {
    strategy: cfg.booking.slotSelectionStrategy,
    autoAccept: cfg.acceptance.autoAccept,
    minDateDaysAhead: cfg.jobFilters.minDateDaysAhead,
    slotDays: cfg.jobFilters.slotDays,
    timezone: cfg.schedule.timezone,
    nonCertMinValue: cfg.jobFilters.nonCertMinValue,
    highValueMin: cfg.jobFilters.highValueMin,
    priceHint: o.priceHint,
  });

  if (outcome.status === "not_worth_taking") {
    // Logged with its bucket so the keyword lists in jobRules can be corrected
    // from real traffic — a mis-bucketed job is money left on the table.
    logger.info(
      `Skip job ${o.externalId} "${o.category}" [${outcome.bucket}] £${o.priceHint ?? "?"}: ${outcome.reason}`,
    );
    await markSeen(o.externalId, { kind: "job", masterOsId: "" });
    return;
  }

  if (outcome.status === "no_valid_slot") {
    logger.info(`Skip job ${o.externalId} "${o.category}": ${outcome.reason}`);
    await markSeen(o.externalId, { kind: "job", masterOsId: "" });
    return;
  }

  if (outcome.status === "lost_race") {
    // Perder a corrida é normal num marketplace disputado. O que não pode é
    // virar job no OS: sem cliente e sem endereço ele entra na fila, ocupa
    // dispatch e some do radar só quando alguém repara. `warn` porque a
    // frequência disso mede se o ciclo do RPA está lento demais.
    logger.warn(`LOST job ${o.externalId} "${o.category}" £${o.priceHint ?? "?"}: ${outcome.reason}`);
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
  // The detail page's title ("Handyperson: Full Day (7 Hrs) General Repairs")
  // is far more specific than the card's category ("General Maintenance"), and
  // it's where the full-day / half-day distinction actually appears.
  const title = accepted.richTitle || o.category;
  const clientName = accepted.customerName || o.customerName || "Unnamed customer";
  const postcode = o.postcode || accepted.customerPostcode;
  const checkatradeLink = detailUrl(o.externalId);

  // O escopo vai para o parceiro, e num convite de auto-assign vai para
  // VÁRIOS parceiros de uma vez: só quem aceita deveria saber quem é o cliente.
  // O nome já vive em `client_name`, então dentro do texto ele é redundante
  // além de vazar cedo. Tira o nome e o parágrafo padrão do Checkatrade, que
  // não descreve trabalho nenhum.
  const scopeLimpo = limparEscopo(
    accepted.customerNotes || accepted.richDescription || o.description,
    [clientName, accepted.customerName, o.customerName],
  );

  const jobPayload = {
    account_id: cfg.masterOs.accountId,
    date: accepted.acceptedDate,
    // Janela COMPLETA da plataforma, sempre (dono, 18/08: "todo job sobe com
    // arrival time certinho"). O fallback existe porque a API exige o campo,
    // mas ele é uma mentira educada — quando disparar, a nota interna grita.
    arrival_time: accepted.acceptedTimeWindow ?? "09:00",
    client_name: clientName,
    // Passing the revealed contact makes /api/jobs create (or match) a REAL
    // client row instead of a name-only stub — the job's customer lands in the
    // contact base as a side effect of the job, with no second write to race.
    client_email: accepted.customerEmail,
    client_phone: accepted.customerPhone,
    property_address: propertyAddress,
    postcode,
    // Título NUNCA inventado (dono, 19/08: "só os que já tem de type of
    // work"): o chip do job no OS é o título, e ele só pode ser um nome da
    // lista canônica — certificado vai com o SKU do catálogo, o resto é
    // General Maintenance. O título rico da plataforma não some: vira a
    // primeira linha do scope, que é onde detalhe mora.
    title: tipoDeTrabalho(title) ?? cfg.fallbackCategory,
    service_type: tipoDeTrabalho(title) ?? cfg.fallbackCategory,
    // Three sources for the brief, best first: the customer's own notes on the
    // accepted page, then the pre-accept "Message" block, then the card's
    // truncated boilerplate.
    description: [`Job: ${title}`, scopeLimpo].filter(Boolean).join("\n\n"),
    // "Your Earnings" beats the card's teaser: it is exact, it already has
    // Checkatrade's fee removed, and the card sometimes has no price at all.
    client_price: accepted.earnings ?? o.priceHint,
    // Parking and duration decide how the office briefs the partner, and
    // neither exists anywhere else. `internal_notes` because /api/jobs has no
    // field for them yet; they are worth more written down than lost.
    internal_notes: [
      accepted.acceptedTimeWindow ? null : "ATTENTION: arrival window NOT captured from the platform — 09:00 is a placeholder, confirm the real slot before dispatch.",
      accepted.duration ? `Booked duration: ${accepted.duration}` : null,
      accepted.parking === undefined ? null : `Parking available: ${accepted.parking ? "yes" : "no"}`,
      accepted.earnings ? `Value: £${accepted.earnings}` : null,
    ]
      .filter(Boolean)
      .join("\n") || undefined,
    // Land as `unassigned` and wait for a human to take action. Auto-assign
    // would fire push + Zendesk invites at partners the moment the job is
    // created; the office wants to triage these first.
    auto_assign: false as const,
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
    title,
    zendeskTicketId: res.zendesk_ticket_id ?? "(none — check OS logs)",
  });

  // Enrich the contact with what /api/jobs doesn't store on a client row
  // (postcode, address, the enquiry text). Idempotent and matched by email, so
  // it updates the row the job just created rather than duplicating it.
  // Non-fatal: the job is already safely recorded, and losing a postcode on a
  // contact must never look like a failed job.
  try {
    await masterOs.upsertContact({
      name: clientName,
      email: accepted.customerEmail,
      phone: accepted.customerPhone,
      postcode,
      address: propertyAddress,
      notes: [
        `checkatrade-job:${o.externalId}`,
        `Job ${res.reference} — ${title}`,
        accepted.richDescription,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
  } catch (err) {
    logger.error(`Job ${res.reference} saved, but contact enrichment failed`, err);
  }
}

/**
 * Limpa o texto que o parceiro vai ler.
 *
 * Duas coisas saem. O parágrafo "This is a Checkatrade Express job. We told the
 * customer that: ..." é boilerplate deles e não descreve o trabalho. E o nome do
 * cliente, que já está em `client_name` e num convite de auto-assign seria
 * mostrado a todos os parceiros convidados, não só ao que aceitar.
 *
 * Nome curto demais não é removido: apagar "Al" ou "Jo" de dentro de palavras
 * mutila o texto, e um primeiro nome de duas letras não identifica ninguém.
 */
function limparEscopo(texto: string | undefined, nomes: (string | undefined)[]): string | undefined {
  if (!texto) return texto;

  let out = texto
    .split(/\n\n+/)
    .filter((p) => !/^\s*This is a Checkatrade Express job/i.test(p))
    .join("\n\n");

  const partes = new Set<string>();
  for (const n of nomes) {
    for (const parte of String(n ?? "").split(/\s+/)) {
      const limpo = parte.replace(/[^\p{L}\p{N}'-]/gu, "");
      if (limpo.length >= 3) partes.add(limpo);
    }
  }
  for (const parte of partes) {
    const escapado = parte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${escapado}\\b`, "gi"), "the customer");
  }

  // "the customer the customer" quando nome e sobrenome estavam colados.
  return out.replace(/\bthe customer(\s+the customer)+\b/gi, "the customer").trim() || undefined;
}
