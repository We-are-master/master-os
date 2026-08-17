/**
 * One-off: sweep EVERY lead on the Checkatrade board — whatever its status,
 * not just the "New" ones the poll loop takes — and push them into the Master
 * OS contact base.
 *
 * Checkatrade hides phone/email until you express interest, so a "New" lead
 * only yields a name + postcode unless --respond is passed. Expressing
 * interest is non-financial (a bid, not a commitment) but IS visible to the
 * customer, which is why it's opt-in rather than the default.
 *
 *   npx tsx src/harvestLeads.ts                       # dry run: parse only
 *   npx tsx src/harvestLeads.ts --respond             # + click "I'm interested"
 *   npx tsx src/harvestLeads.ts --respond --push      # + write to Master OS
 *   --account <uuid>   which account owns the contacts
 *   --workers <n>      parallel pages (default 4)
 */
import { writeFileSync } from "node:fs";
import type { Page } from "playwright";
import { loadConfig, STATE_DIR } from "./config.js";
import { getOrCreateContext } from "./checkatrade/auth.js";
import { parseLeadContact, parseLeadIdentity, parseLeadMessage, readLeafFields } from "./checkatrade/leadResponse.js";
import { logger } from "./logger.js";

const BOARD_URL = "https://membersapp.checkatrade.com/jobs/all";
const CARD_SELECTOR = '[data-testid^="job-card-v2-"]';
const LEAF_TEXT_SELECTOR = '[data-testid="toolshed-native-typography"]';
const CARD_TESTID_PREFIX = "job-card-v2-";

/**
 * Pacing, PER WORKER.
 *
 * The 2026-07-28 block came from ~600ms between pages on a single page — call
 * it 100 requests/min. A rate limiter cares about the TOTAL rate, not how many
 * pages produce it, so the budget is spent deliberately: 4 workers at ~11s per
 * lead each lands near 22/min, comfortably under a quarter of what tripped the
 * block. More workers means a longer delay to match, not a free speedup.
 */
const DELAY_MIN_MS = 5_000;
const DELAY_JITTER_MS = 4_000;
const DEFAULT_WORKERS = 4;

/** Push every N leads so an interruption never throws away the whole sweep. */
const PUSH_BATCH = 25;

function isRealCardTestid(testid: string): boolean {
  if (!testid.startsWith(CARD_TESTID_PREFIX)) return false;
  const suffix = testid.slice(CARD_TESTID_PREFIX.length);
  if (suffix.length < 10) return false;
  return /\d/.test(suffix) && !/^[a-z]+(-[a-z]+)*$/.test(suffix);
}

function isCloudflareBlock(text: string): boolean {
  return /Sorry, you have been blocked|unable to access checkatrade\.com|Cloudflare Ray ID/i.test(text);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type HarvestedLead = {
  externalId: string;
  status: string;
  name?: string;
  location?: string;
  postcode?: string;
  phone?: string;
  email?: string;
  category?: string;
  message?: string;
};

type RawCard = { id: string; status: string; fields: string[] };

/**
 * Collect every card by reading DURING the scroll — the list is virtualised, so
 * only ~12 cards exist in the DOM at a time and they are recycled as it moves.
 * Scrolling to the bottom and reading afterwards captures only the last window
 * (see dashboard.ts collectCards for the full write-up).
 */
async function collectCards(page: Page): Promise<RawCard[]> {
  const found = new Map<string, RawCard>();
  const cards = page.locator(CARD_SELECTOR);
  let roundsWithoutNew = 0;

  for (let round = 0; round < 600 && roundsWithoutNew < 15; round++) {
    const before = found.size;
    const count = await cards.count();

    for (let i = 0; i < count; i++) {
      const testid = await cards.nth(i).getAttribute("data-testid").catch(() => null);
      if (!testid || !isRealCardTestid(testid)) continue;
      const id = testid.slice(CARD_TESTID_PREFIX.length);
      if (found.has(id)) continue;
      const fields = (await cards.nth(i).locator(LEAF_TEXT_SELECTOR).allTextContents().catch(() => []))
        .map((t) => t.trim())
        .filter(Boolean);
      const status =
        (await cards
          .nth(i)
          .locator('[data-testid="toolshed-native-status-pill-label"]')
          .first()
          .textContent()
          .catch(() => null))?.trim() || "(none)";
      found.set(id, { id, status, fields });
    }

    roundsWithoutNew = found.size === before ? roundsWithoutNew + 1 : 0;
    await page.mouse.move(900, 500).catch(() => {});
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(450);
  }
  return [...found.values()];
}

/** Read one lead's detail page. "blocked" means Cloudflare, stop everything. */
async function readLead(
  page: Page,
  externalId: string,
  status: string,
  respond: boolean,
): Promise<HarvestedLead | "blocked"> {
  await page.goto(`https://membersapp.checkatrade.com/jobs/${externalId}`, { waitUntil: "domcontentloaded" });

  // Wait for the DATA, not for the network to fall silent. `networkidle` burned
  // up to 15s per lead on analytics chatter that never settles, while the leaf
  // nodes we actually read paint in ~2s. That wait, not the anti-block delay,
  // was most of the original ~36s cost per lead.
  await page.locator(LEAF_TEXT_SELECTOR).first().waitFor({ state: "attached", timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(600);

  if (isCloudflareBlock(await page.locator("body").innerText().catch(() => ""))) return "blocked";

  let fields = await readLeafFields(page);

  // Checkatrade hides phone/email until you express interest. Same
  // non-financial action the poll loop takes, but visible to the customer —
  // hence opt-in. Guarded on visibility: an already-responded lead has no
  // button and clicking again would just error.
  if (respond) {
    const btn = page.locator('button[aria-label="I\'m interested"]');
    if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await btn.click({ timeout: 10_000 });
      await page.waitForTimeout(2_500);
      fields = await readLeafFields(page);
      logger.info(`  clicked "I'm interested" on ${externalId}`);
    }
  }

  const { name, location, postcode } = parseLeadIdentity(fields);
  const { phone, email } = parseLeadContact(fields);
  return {
    externalId,
    status,
    name,
    location,
    postcode,
    phone,
    email,
    category: fields.find((f) => f === "Handyman") ?? undefined,
    message: parseLeadMessage(fields),
  };
}

async function main(): Promise<void> {
  const push = process.argv.includes("--push");
  const respond = process.argv.includes("--respond");
  const workerCount = Math.max(1, Number(argValue("--workers") ?? DEFAULT_WORKERS));
  const cfg = loadConfig();

  // Which account owns the contacts. Defaults to the RPA's own (Checkatrade,
  // the channel), but the backfill files them under Fixfy — these people are
  // Fixfy's own relationships to work with email/WhatsApp, not the channel's.
  const accountId = argValue("--account") ?? cfg.masterOs.accountId;
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) throw new Error(`bad --account uuid: ${accountId}`);
  logger.info(`Contacts under account ${accountId} · ${workerCount} worker(s)`);

  const { browser, context, page } = await getOrCreateContext(cfg);

  await page.goto(BOARD_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  if (isCloudflareBlock(await page.locator("body").innerText().catch(() => ""))) {
    logger.error("CLOUDFLARE BLOCK on the board — nothing harvested. Wait it out and re-run.");
    await browser.close();
    process.exit(2);
  }

  // Pass 1: every LEAD card on the board (no "Checkatrade Express" leaf).
  const raw = await collectCards(page);
  let leadIds = raw
    .filter((c) => !c.fields.includes("Checkatrade Express"))
    .map((c) => ({ externalId: c.id, status: c.status }));
  logger.info(`Found ${leadIds.length} lead cards`, {
    byStatus: leadIds.reduce<Record<string, number>>((a, l) => ((a[l.status] = (a[l.status] ?? 0) + 1), a), {}),
  });

  if (process.argv.includes("--already-responded")) {
    const before = leadIds.length;
    leadIds = leadIds.filter((l) => l.status !== "New");
    logger.info(`--already-responded: ${leadIds.length} of ${before} (skipping the New ones)`);
  }

  // Skip what the OS already has: re-reading a filed lead costs a page load and
  // a delay just to be told "skipped". On a board this size that is hours of
  // waste, and it turns a restart into a resume.
  if (push) {
    try {
      const res = await fetch(`${cfg.masterOs.baseUrl}/api/contacts/coverage`, {
        headers: { "X-API-Key": cfg.env.masterOsLeadApiKey },
      });
      if (res.ok) {
        const known = new Set<string>(((await res.json()) as { external_ids?: string[] }).external_ids ?? []);
        const before = leadIds.length;
        leadIds = leadIds.filter((l) => !known.has(l.externalId));
        logger.info(`Já no OS: ${before - leadIds.length} pulados, ${leadIds.length} a processar`);
      }
    } catch (err) {
      logger.warn(`Não consegui ler a cobertura (seguindo sem pular): ${String(err)}`);
    }
  }

  // ── Shared state across workers ────────────────────────────────────────
  const harvested: HarvestedLead[] = [];
  const totals = { created: 0, updated: 0, skipped: 0, unusable: 0, failed: 0 };
  let pending: HarvestedLead[] = [];
  let cursor = 0;
  let aborted = false;

  /**
   * Flushes are SERIALISED through this promise chain. Workers run
   * concurrently, so two crossing the batch threshold together would both read
   * `pending`, both send it, and duplicate the batch. Chaining guarantees one
   * flush at a time without needing a lock.
   */
  let flushChain: Promise<void> = Promise.resolve();

  async function doFlush(force: boolean): Promise<void> {
    if (!push || pending.length === 0 || (!force && pending.length < PUSH_BATCH)) return;
    const batch = pending;
    pending = [];

    // Minimum bar set by the business: a name, SOME way to reach them, and an
    // address. Short of that the email/WhatsApp automation can't work the row,
    // so it's noise in the contact base rather than a lead.
    const usable = batch.filter((l) => l.name && (l.email || l.phone) && l.location);
    for (const d of batch.filter((l) => !(l.name && (l.email || l.phone) && l.location))) {
      totals.unusable++;
      logger.warn(
        `  fora do critério ${d.externalId}: nome=${d.name ?? "-"} email=${d.email ?? "-"} tel=${d.phone ?? "-"} end=${d.location ?? "-"}`,
      );
    }
    if (usable.length === 0) return;

    const contacts = usable.map((l) => ({
      name: l.name,
      email: l.email,
      phone: l.phone,
      postcode: l.postcode,
      address: l.location,
      // `checkatrade-lead:<id>` makes coverage provable — without it the only
      // link back to the lead is the email, which can't answer "is every lead
      // we paid for in the base?".
      notes: [
        `checkatrade-lead:${l.externalId}`,
        `Enquiry (${l.status}) — ${l.category ?? ""}`.trim(),
        l.message,
      ]
        .filter(Boolean)
        .join("\n\n"),
    }));

    try {
      const res = await fetch(`${cfg.masterOs.baseUrl}/api/contacts/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-API-Key": cfg.env.masterOsLeadApiKey },
        body: JSON.stringify({ account_id: accountId, contacts }),
      });
      const body = (await res.json()) as { created?: number; updated?: number; skipped?: number };
      if (!res.ok) throw new Error(JSON.stringify(body).slice(0, 300));
      totals.created += body.created ?? 0;
      totals.updated += body.updated ?? 0;
      totals.skipped += body.skipped ?? 0;
      logger.info(
        `  lote: +${body.created ?? 0} criados, +${body.updated ?? 0} enriquecidos · acumulado ${totals.created}/${totals.updated} · lidos ${harvested.length}/${leadIds.length}`,
      );
    } catch (err) {
      // Put them back so the next flush retries rather than losing the batch.
      pending = batch.concat(pending);
      logger.error(`  lote falhou, reenvia no próximo flush: ${String(err)}`);
    }
  }

  function scheduleFlush(force = false): Promise<void> {
    flushChain = flushChain.then(() => doFlush(force));
    return flushChain;
  }

  // ── Workers ────────────────────────────────────────────────────────────
  async function worker(id: number, wp: Page): Promise<void> {
    while (!aborted) {
      const i = cursor++;
      if (i >= leadIds.length) return;
      const { externalId, status } = leadIds[i];
      try {
        const out = await readLead(wp, externalId, status, respond);
        if (out === "blocked") {
          // One block means every subsequent page is the block page too. Stop
          // everything rather than filling the base with parsed-nothing rows.
          aborted = true;
          logger.error(`CLOUDFLARE BLOCK (w${id}) em ${externalId} — parando tudo. Espere e re-rode.`);
          return;
        }
        harvested.push(out);
        pending.push(out);
        logger.info(`  [w${id}] ${externalId}: ${out.name ?? "(sem nome)"} ${out.location ?? ""}`);
        await scheduleFlush();
      } catch (err) {
        totals.failed++;
        logger.error(`  [w${id}] falhou ${externalId}: ${String(err).slice(0, 120)}`);
      }
      await sleep(DELAY_MIN_MS + Math.random() * DELAY_JITTER_MS);
    }
  }

  const pages: Page[] = [page];
  for (let i = 1; i < workerCount; i++) pages.push(await context.newPage());

  const startedAt = Date.now();
  await Promise.all(pages.map((wp, i) => worker(i + 1, wp)));
  await scheduleFlush(true);
  await flushChain;

  const mins = (Date.now() - startedAt) / 60000;
  writeFileSync(`${STATE_DIR}/harvest-leads.json`, JSON.stringify(harvested, null, 2));
  logger.info(
    `FIM: ${harvested.length} lidos em ${mins.toFixed(1)}min (${(harvested.length / Math.max(mins, 0.1)).toFixed(1)}/min) · ` +
      `${totals.created} criados · ${totals.updated} enriquecidos · ${totals.skipped} já completos · ` +
      `${totals.unusable} fora do critério · ${totals.failed} falhas${aborted ? " · ABORTADO POR BLOQUEIO" : ""}`,
  );
  await browser.close();
}

main().catch((err) => {
  logger.error("harvestLeads failed", err);
  process.exit(1);
});
