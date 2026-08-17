/**
 * Read-only: pull what Checkatrade says it has PAID us.
 *
 * Two sources, because they answer different halves of the question:
 *   /job-payments  → Checkatrade Pay. Tabs: Requested / Paid / Cancelled /
 *                    Balance payout. "Paid" is money actually received.
 *   /jobs/business → the Express board, filtered to Completed. A job can be
 *                    Completed and still unpaid, so this alone proves nothing
 *                    about cash — it's the work side of the match.
 *
 * Writes .state/payments-dump.json for the reconciliation to consume.
 * Never clicks anything that commits.
 *
 *   npx tsx src/dumpPayments.ts
 */
import { writeFileSync } from "node:fs";
import type { Page } from "playwright";
import { loadConfig, STATE_DIR } from "./config.js";
import { getOrCreateContext } from "./checkatrade/auth.js";
import { readLeafFields } from "./checkatrade/leadResponse.js";
import { logger } from "./logger.js";

const CARD_SELECTOR = '[data-testid^="job-card-v2-"]';
const LEAF = '[data-testid="toolshed-native-typography"]';
const STATUS = '[data-testid="toolshed-native-status-pill-label"]';
const PREFIX = "job-card-v2-";

function isRealCard(t: string): boolean {
  const s = t.slice(PREFIX.length);
  return s.length >= 10 && /\d/.test(s) && !/^[a-z]+(-[a-z]+)*$/.test(s);
}

/** Scroll the payments list, harvesting rows as they render (virtualised too). */
async function scrollHarvest(page: Page, rounds = 40): Promise<string[]> {
  const seen = new Set<string>();
  let quiet = 0;
  for (let i = 0; i < rounds && quiet < 6; i++) {
    const before = seen.size;
    for (const f of await readLeafFields(page)) seen.add(f);
    quiet = seen.size === before ? quiet + 1 : 0;
    await page.mouse.move(900, 500).catch(() => {});
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(500);
  }
  return [...seen];
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { browser, page } = await getOrCreateContext(cfg);
  const out: Record<string, unknown> = {};

  // ── 1. Checkatrade Pay ────────────────────────────────────────────────
  await page.goto("https://membersapp.checkatrade.com/job-payments", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // A product tour ("Get paid with Checkatrade Pay") covers the page on a fresh
  // session and swallows every click underneath — that, not a cookie wall, is
  // what made the tab clicks time out. Dismissing it commits to nothing.
  const skip = page.locator('[data-testid="toolshed-native-guide-skip-button"]');
  if (await skip.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await skip.click().catch(() => {});
    await page.waitForTimeout(1500);
    logger.info("tour dispensado");
  }

  for (const tab of ["Paid", "Requested", "Balance payout"]) {
    try {
      await page.getByText(tab, { exact: false }).first().click({ timeout: 8_000 });
      await page.waitForTimeout(2500);
      const rows = await scrollHarvest(page);
      out[`pay:${tab}`] = rows;
      logger.info(`─── Checkatrade Pay · ${tab}: ${rows.length} nós`);
      for (const r of rows.slice(0, 60)) console.log(`     ${r.slice(0, 95)}`);
    } catch (err) {
      logger.warn(`aba ${tab}: ${String(err).slice(0, 80)}`);
    }
    await page.waitForTimeout(2000);
  }

  // ── 2. Express board, Completed only ──────────────────────────────────
  await page.goto("https://membersapp.checkatrade.com/jobs/business", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

  const cards = page.locator(CARD_SELECTOR);
  const found = new Map<string, { id: string; status: string; fields: string[] }>();
  let quiet = 0;
  for (let i = 0; i < 200 && quiet < 12; i++) {
    const before = found.size;
    const n = await cards.count();
    for (let j = 0; j < n; j++) {
      const testid = await cards.nth(j).getAttribute("data-testid").catch(() => null);
      if (!testid || !isRealCard(testid) || found.has(testid)) continue;
      const fields = (await cards.nth(j).locator(LEAF).allTextContents().catch(() => [])).map((t) => t.trim()).filter(Boolean);
      const status = (await cards.nth(j).locator(STATUS).first().textContent().catch(() => null))?.trim() || "(none)";
      found.set(testid, { id: testid.slice(PREFIX.length), status, fields });
    }
    quiet = found.size === before ? quiet + 1 : 0;
    await page.mouse.move(900, 500).catch(() => {});
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(450);
  }
  const all = [...found.values()].filter((c) => c.fields.includes("Checkatrade Express"));
  const completed = all.filter((c) => c.status === "Completed");
  out["express:all"] = all;
  out["express:completed"] = completed;
  logger.info(`─── Express: ${all.length} jobs · ${completed.length} Completed`);
  for (const c of completed) {
    const price = c.fields.find((f) => /£\s*[\d,.]+/.test(f)) ?? "";
    const pc = c.fields.find((f) => /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/.test(f)) ?? "";
    console.log(`     ${c.fields[0]?.slice(0, 44).padEnd(46)}${price.padEnd(18)}${pc.padEnd(10)}${c.id}`);
  }

  writeFileSync(`${STATE_DIR}/payments-dump.json`, JSON.stringify(out, null, 2));
  logger.info(`salvo em ${STATE_DIR}/payments-dump.json`);
  await browser.close();
}

main().catch((err) => {
  logger.error("dumpPayments failed", err);
  process.exit(1);
});
