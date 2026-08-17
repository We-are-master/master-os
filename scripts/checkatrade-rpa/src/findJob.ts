/**
 * Read-only: list every Express job card across the boards, whatever its
 * status, with its title and earnings. Used to locate a specific job before
 * accepting it by hand. Never clicks Accept.
 *
 *   npx tsx src/findJob.ts
 */
import { loadConfig } from "./config.js";
import { getOrCreateContext } from "./checkatrade/auth.js";
import { logger } from "./logger.js";
import type { Page } from "playwright";

const CARD_SELECTOR = '[data-testid^="job-card-v2-"]';
const LEAF = '[data-testid="toolshed-native-typography"]';
const STATUS = '[data-testid="toolshed-native-status-pill-label"]';
const PREFIX = "job-card-v2-";

const BOARDS = [
  ["Express jobs", "https://membersapp.checkatrade.com/jobs/business"],
  ["My jobs", "https://membersapp.checkatrade.com/jobs/all"],
  ["Opportunities", "https://membersapp.checkatrade.com/jobs/opportunities-board"],
];

function isRealCard(testid: string): boolean {
  const s = testid.slice(PREFIX.length);
  return s.length >= 10 && /\d/.test(s) && !/^[a-z]+(-[a-z]+)*$/.test(s);
}

export type Card = { id: string; status: string; fields: string[] };

/**
 * Collect cards INCREMENTALLY while scrolling.
 *
 * The list is virtualised: only ~12 cards exist in the DOM at any moment and
 * they are recycled as you scroll. Scrolling to the bottom and reading
 * afterwards therefore returns only the last window — which is why two scans
 * six minutes apart returned twelve completely different jobs, and why New
 * jobs kept being missed. Read after every small scroll step and dedupe by
 * the card's own id.
 */
async function collectWhileScrolling(page: Page): Promise<Map<string, Card>> {
  const found = new Map<string, Card>();
  const cards = page.locator(CARD_SELECTOR);

  let roundsWithoutNew = 0;
  for (let step = 0; step < 60 && roundsWithoutNew < 6; step++) {
    const before = found.size;
    const n = await cards.count();

    for (let i = 0; i < n; i++) {
      const testid = await cards.nth(i).getAttribute("data-testid").catch(() => null);
      if (!testid || !isRealCard(testid)) continue;
      const id = testid.slice(PREFIX.length);
      if (found.has(id)) continue;
      const fields = (await cards.nth(i).locator(LEAF).allTextContents().catch(() => []))
        .map((t) => t.trim())
        .filter(Boolean);
      const status =
        (await cards.nth(i).locator(STATUS).first().textContent().catch(() => null))?.trim() || "(none)";
      found.set(id, { id, status, fields });
    }

    roundsWithoutNew = found.size === before ? roundsWithoutNew + 1 : 0;

    // Small steps: a big jump skips past recycled rows without ever rendering
    // them, which is the same blindness in a different disguise.
    await page.mouse.move(900, 500).catch(() => {});
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(500);
  }
  return found;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { browser, page } = await getOrCreateContext(cfg);

  for (const [name, url] of BOARDS) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    const found = await collectWhileScrolling(page);

    logger.info(`─── ${name} — ${found.size} cards no total ───`);
    for (const c of found.values()) {
      const kind = c.fields.includes("Checkatrade Express") ? "JOB " : "lead";
      const price = c.fields.find((f) => /£\s*[\d,.]+/.test(f)) ?? "";
      const postcode = c.fields.find((f) => /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/.test(f)) ?? "";
      console.log(`  ${kind} [${c.status}] ${c.fields[0]}  ${price}  ${postcode}  id=${c.id}`);
    }
    if (found.size === 0) console.log("  (nenhum card nesta aba)");

    // Screenshot per board — the bot's session may simply be seeing different
    // inventory from the browser the job was spotted in, and a picture settles
    // that faster than more scraping.
    const slug = name.replace(/\s+/g, "-").toLowerCase();
    await page.screenshot({ path: `.state/board-${slug}.png`, fullPage: true }).catch(() => {});
    console.log(`  → print salvo em .state/board-${slug}.png`);
    await page.waitForTimeout(2500);
  }

  await browser.close();
}

main().catch((err) => {
  logger.error("findJob failed", err);
  process.exit(1);
});
