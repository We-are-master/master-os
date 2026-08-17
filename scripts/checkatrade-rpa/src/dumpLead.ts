/**
 * Debug: dump one lead's detail page as the app's own ordered leaf text nodes,
 * which is the only reliable view of it.
 *
 * VERIFIED 2026-07-28: `body.innerText` on this page returns the SIDEBAR ONLY
 * (886 chars) while `textContent` has the full 5322 — the detail panel never
 * reaches innerText, so the old innerText regexes matched nothing at all.
 * textContent is no good either (no separators between nodes:
 * "…Friday 29 MayTTTeisi TammingLondon, SE12LP…"). The leaf testid gives both
 * the text and its boundaries.
 *
 *   npx tsx src/dumpLead.ts <externalId>
 */
import { writeFileSync } from "node:fs";
import { loadConfig, STATE_DIR } from "./config.js";
import { getOrCreateContext } from "./checkatrade/auth.js";
import { parseLeadContact, parseLeadIdentity, parseLeadMessage, readLeafFields } from "./checkatrade/leadResponse.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  const externalId = process.argv[2];
  if (!externalId) throw new Error("usage: tsx src/dumpLead.ts <externalId>");

  const cfg = loadConfig();
  const { browser, page } = await getOrCreateContext(cfg);

  await page.goto(`https://membersapp.checkatrade.com/jobs/${externalId}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  logger.info(`landed on ${page.url()}`);

  const fields = await readLeafFields(page);
  logger.info(`LEAF NODES: ${fields.length}`);
  fields.forEach((f, i) => console.log(`  [${i}] ${f.slice(0, 140)}`));

  console.log("──────── PARSED ────────");
  console.log(JSON.stringify(
    { ...parseLeadIdentity(fields), ...parseLeadContact(fields), message: parseLeadMessage(fields) },
    null,
    2,
  ));

  writeFileSync(`${STATE_DIR}/lead-dump.json`, JSON.stringify(fields, null, 2));
  await page.screenshot({ path: `${STATE_DIR}/lead-dump.png`, fullPage: true }).catch(() => {});
  await browser.close();
}

main().catch((err) => {
  logger.error("dumpLead failed", err);
  process.exit(1);
});
