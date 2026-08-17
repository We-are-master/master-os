/**
 * Read-only recon of the Checkatrade billing area.
 *
 * The sidebar carries "My billing" → Customer payments / Customer quoting &
 * invoicing / Checkatrade invoices & payment. We need to know what the portal
 * actually exposes about money RECEIVED before any invoice in the OS is marked
 * paid on the strength of it.
 *
 * Never clicks anything that commits: navigation and reading only.
 *
 *   npx tsx src/dumpBilling.ts
 */
import { writeFileSync } from "node:fs";
import { loadConfig, STATE_DIR } from "./config.js";
import { getOrCreateContext } from "./checkatrade/auth.js";
import { readLeafFields } from "./checkatrade/leadResponse.js";
import { logger } from "./logger.js";

const PAGES = [
  ["customer-payments", "https://membersapp.checkatrade.com/billing/customer-payments"],
  ["invoices", "https://membersapp.checkatrade.com/billing/invoices"],
  ["payments", "https://membersapp.checkatrade.com/billing/payments"],
  ["billing", "https://membersapp.checkatrade.com/billing"],
];

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { browser, page } = await getOrCreateContext(cfg);

  // First: what does the sidebar actually link to? Guessing URLs is how you
  // end up reporting "nothing there" for a page that simply moved.
  await page.goto("https://membersapp.checkatrade.com/home", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  const links = await page.locator("a").evaluateAll((els) =>
    els
      .map((e) => ({ text: (e.textContent ?? "").trim(), href: (e as HTMLAnchorElement).href }))
      .filter((l) => l.href && /bill|payment|invoic|earn|finance/i.test(l.href + l.text)),
  );
  logger.info(`links de billing encontrados: ${links.length}`);
  for (const l of links) console.log(`   ${l.text.slice(0, 34).padEnd(36)}${l.href}`);

  const out: Record<string, string[]> = {};
  for (const [name, url] of [...links.map((l) => [l.text || "link", l.href] as [string, string]), ...PAGES]) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const fields = await readLeafFields(page);
      // Drop the app shell nav that every page repeats.
      const body = fields.slice(fields.findIndex((f) => f === "Log out") + 1);
      out[`${name} ${url}`] = body;
      logger.info(`─── ${name} (${page.url()}) — ${body.length} nós`);
      for (const f of body.slice(0, 30)) console.log(`     ${f.slice(0, 100)}`);
    } catch (err) {
      logger.warn(`${name}: ${String(err).slice(0, 90)}`);
    }
    await page.waitForTimeout(2500);
  }
  writeFileSync(`${STATE_DIR}/billing-dump.json`, JSON.stringify(out, null, 2));
  await browser.close();
}

main().catch((err) => {
  logger.error("dumpBilling failed", err);
  process.exit(1);
});
