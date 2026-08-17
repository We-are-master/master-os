/**
 * Structural probe of /job-payments. The tab clicks failed with a bare
 * getByText regex, so before guessing again: list what is actually clickable,
 * with roles and testids, and dump the rows the default view renders.
 *
 *   npx tsx src/probePayments.ts
 */
import { writeFileSync } from "node:fs";
import { loadConfig, STATE_DIR } from "./config.js";
import { getOrCreateContext } from "./checkatrade/auth.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { browser, page } = await getOrCreateContext(cfg);

  await page.goto("https://membersapp.checkatrade.com/job-payments", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
  await page.waitForTimeout(3000);
  logger.info(`landed: ${page.url()}`);

  const clickables = await page.locator("button, [role=tab], a, [role=button]").evaluateAll((els) =>
    els
      .map((e) => ({
        tag: e.tagName.toLowerCase(),
        role: e.getAttribute("role") ?? "",
        testid: e.getAttribute("data-testid") ?? "",
        aria: e.getAttribute("aria-label") ?? "",
        text: (e.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60),
      }))
      .filter((e) => e.text || e.aria),
  );
  logger.info(`clicáveis: ${clickables.length}`);
  for (const c of clickables.slice(0, 45)) {
    console.log(`   <${c.tag}> role=${c.role || "-"} testid=${c.testid || "-"} | ${c.aria || c.text}`);
  }

  // What the default view renders as rows, with the raw text so amounts and
  // references are visible even if the leaf testid isn't used here.
  const bodyText = await page.locator("body").innerText().catch(() => "");
  console.log("\n──── innerText (2500) ────");
  console.log(bodyText.slice(0, 2500));

  writeFileSync(`${STATE_DIR}/payments-probe.json`, JSON.stringify({ clickables, bodyText }, null, 2));
  await page.screenshot({ path: `${STATE_DIR}/payments.png`, fullPage: true }).catch(() => {});
  await browser.close();
}

main().catch((err) => {
  logger.error("probePayments failed", err);
  process.exit(1);
});
