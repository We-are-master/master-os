// One-off live diagnostic: reuses the bot's own session + scraper to answer
// "is the RPA blind, or is the feed genuinely empty of New jobs right now?".
// Run inside the same Docker image (xvfb) so Cloudflare behaves as it does for
// the real loop. Does NOT accept anything — read-only.
import { loadConfig } from "./config.js";
import { getOrCreateContext } from "./checkatrade/auth.js";
import { scrapeOpportunities } from "./checkatrade/dashboard.js";
import { logger } from "./logger.js";

const FEED_URL = "https://membersapp.checkatrade.com/jobs/all";
const CARD_SELECTOR = '[data-testid^="job-card-v2-"]';
const STATUS_SELECTOR = '[data-testid="toolshed-native-status-pill-label"]';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { browser, page } = await getOrCreateContext(cfg); // logs in if session died

  await page.goto(FEED_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  const url = page.url();
  const title = await page.title().catch(() => "");
  logger.info("PROBE page", { url, title });

  // Raw card diagnostics (before the New-only filter the scraper applies).
  const cards = page.locator(CARD_SELECTOR);
  const rawCount = await cards.count();
  const statuses: Record<string, number> = {};
  const sample: string[] = [];
  for (let i = 0; i < rawCount; i++) {
    const testid = await cards.nth(i).getAttribute("data-testid");
    if (testid === "job-card-v2-job-source-label") continue; // not a real card
    const status =
      (await cards.nth(i).locator(STATUS_SELECTOR).first().textContent().catch(() => null))?.trim() || "(none)";
    statuses[status] = (statuses[status] ?? 0) + 1;
    if (sample.length < 5) {
      const leaves = await cards.nth(i).locator('[data-testid="toolshed-native-typography"]').allTextContents();
      sample.push(`[${status}] ${leaves.map((t) => t.trim()).filter(Boolean).slice(0, 3).join(" · ")}`);
    }
  }
  logger.info("PROBE raw cards", { rawCount, byStatus: statuses });
  for (const s of sample) logger.info(`PROBE sample ${s}`);

  // Exact code path the bot uses each cycle.
  try {
    const opps = await scrapeOpportunities(page);
    const byKind = opps.reduce<Record<string, number>>((a, o) => ((a[o.kind] = (a[o.kind] ?? 0) + 1), a), {});
    logger.info("PROBE scrapeOpportunities", { total: opps.length, byKind });
    for (const o of opps.slice(0, 8)) logger.info(`PROBE opp [${o.kind}] "${o.category}" ${o.postcode ?? ""}`);
  } catch (err) {
    logger.error("PROBE scrapeOpportunities threw", err);
  }

  await page.screenshot({ path: ".state/probe-live.png", fullPage: true }).catch(() => {});
  logger.info("PROBE screenshot saved to .state/probe-live.png");
  await browser.close();
}

main().catch((err) => {
  logger.error("PROBE failed", err);
  process.exit(1);
});
