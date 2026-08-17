/**
 * Debug: dump an Express job's detail page as the app's own leaf text nodes.
 *
 * booking.ts still reads `body.innerText`, which we proved blind on the LEAD
 * detail page (sidebar only). This checks whether the job page has the same
 * problem — if it does, the customer name, phone/email and rich description
 * the RPA sends to Master OS have been silently empty all along.
 *
 *   npx tsx src/dumpJob.ts <externalId>
 */
import { writeFileSync } from "node:fs";
import { loadConfig, STATE_DIR } from "./config.js";
import { getOrCreateContext } from "./checkatrade/auth.js";
import { readLeafFields } from "./checkatrade/leadResponse.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  const externalId = process.argv[2];
  if (!externalId) throw new Error("usage: tsx src/dumpJob.ts <externalId>");

  const cfg = loadConfig();
  const { browser, page } = await getOrCreateContext(cfg);

  await page.goto(`https://membersapp.checkatrade.com/business-jobs/${externalId}?source=express`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  logger.info(`landed on ${page.url()}`);

  const innerText = await page.locator("body").innerText().catch(() => "");
  logger.info(`body.innerText length = ${innerText.length}`);

  const fields = await readLeafFields(page);
  logger.info(`LEAF NODES: ${fields.length}`);
  fields.forEach((f, i) => console.log(`  [${i}] ${f.slice(0, 140)}`));

  writeFileSync(`${STATE_DIR}/job-dump.json`, JSON.stringify(fields, null, 2));
  await page.screenshot({ path: `${STATE_DIR}/job-dump.png`, fullPage: true }).catch(() => {});
  await browser.close();
}

main().catch((err) => {
  logger.error("dumpJob failed", err);
  process.exit(1);
});
