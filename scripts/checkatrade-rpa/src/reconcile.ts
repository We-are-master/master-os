/**
 * Coverage check: is every Checkatrade lead we've responded to actually in the
 * Master OS contact base?
 *
 * Counting rows on each side can't answer that — it only says whether the
 * totals look similar. This matches lead-by-lead on the `checkatrade-lead:<id>`
 * marker stamped into each contact's notes, so the answer is a list of the
 * specific leads that are missing, not a number that looks about right.
 *
 * Read-only on both sides.
 *
 *   npx tsx src/reconcile.ts [--account <uuid>]
 */
import { writeFileSync } from "node:fs";
import type { Page } from "playwright";
import { loadConfig, STATE_DIR } from "./config.js";
import { getOrCreateContext } from "./checkatrade/auth.js";
import { logger } from "./logger.js";

const BOARD_URL = "https://membersapp.checkatrade.com/jobs/all";
const CARD_SELECTOR = '[data-testid^="job-card-v2-"]';
const LEAF = '[data-testid="toolshed-native-typography"]';
const STATUS = '[data-testid="toolshed-native-status-pill-label"]';
const PREFIX = "job-card-v2-";

function isRealCard(testid: string): boolean {
  const s = testid.slice(PREFIX.length);
  return s.length >= 10 && /\d/.test(s) && !/^[a-z]+(-[a-z]+)*$/.test(s);
}

/** Same incremental read as the scraper — the list is virtualised. */
async function collect(page: Page): Promise<{ id: string; status: string; isJob: boolean }[]> {
  const found = new Map<string, { id: string; status: string; isJob: boolean }>();
  const cards = page.locator(CARD_SELECTOR);
  let quiet = 0;
  for (let i = 0; i < 600 && quiet < 15; i++) {
    const before = found.size;
    const n = await cards.count();
    for (let j = 0; j < n; j++) {
      const testid = await cards.nth(j).getAttribute("data-testid").catch(() => null);
      if (!testid || !isRealCard(testid)) continue;
      const id = testid.slice(PREFIX.length);
      if (found.has(id)) continue;
      const fields = (await cards.nth(j).locator(LEAF).allTextContents().catch(() => [])).map((t) => t.trim());
      const status =
        (await cards.nth(j).locator(STATUS).first().textContent().catch(() => null))?.trim() || "(none)";
      found.set(id, { id, status, isJob: fields.includes("Checkatrade Express") });
    }
    quiet = found.size === before ? quiet + 1 : 0;
    await page.mouse.move(900, 500).catch(() => {});
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(450);
  }
  return [...found.values()];
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { browser, page } = await getOrCreateContext(cfg);

  await page.goto(BOARD_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  const cards = await collect(page);
  await browser.close();

  const leads = cards.filter((c) => !c.isJob);
  const responded = leads.filter((c) => c.status !== "New");
  logger.info(`Board: ${leads.length} leads (${responded.length} já respondidos, ${leads.length - responded.length} New)`);

  // Which ids does the OS already know about? The marker lives in notes.
  const res = await fetch(`${cfg.masterOs.baseUrl}/api/contacts/coverage`, {
    headers: { "X-API-Key": cfg.env.masterOsLeadApiKey },
  });
  if (!res.ok) throw new Error(`coverage endpoint ${res.status}: ${await res.text()}`);
  const payload = (await res.json()) as { external_ids?: string[] };
  const known = new Set<string>(payload.external_ids ?? []);
  logger.info(`Master OS knows ${known.size} Checkatrade lead ids`);

  const missing = responded.filter((l) => !known.has(l.id));
  const covered = responded.length - missing.length;
  const pct = responded.length ? ((covered / responded.length) * 100).toFixed(1) : "100.0";

  logger.info(`COBERTURA: ${covered}/${responded.length} (${pct}%) dos leads respondidos estão no OS`);
  if (missing.length) {
    logger.warn(`FALTAM ${missing.length}:`);
    for (const m of missing.slice(0, 40)) console.log(`   ${m.id}  [${m.status}]`);
    if (missing.length > 40) console.log(`   … e mais ${missing.length - 40}`);
  }
  writeFileSync(`${STATE_DIR}/reconcile.json`, JSON.stringify({ responded: responded.length, covered, missing }, null, 2));
}

main().catch((err) => {
  logger.error("reconcile failed", err);
  process.exit(1);
});
