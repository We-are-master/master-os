/**
 * One-off manual accept of a specific Express job, by id.
 *
 * Runs the SAME path the poll loop uses (handleOpportunity → handleJob), so
 * every guard still applies: worth-taking rules, date/slot rules, the Master
 * OS preflight, and the job + contact + Zendesk writes. The only thing it
 * skips is the run-window check, which is the point — it exists for taking a
 * job outside hours rather than losing it overnight.
 *
 *   npx tsx src/acceptOne.ts <externalId> <price> "<title>" [postcode]
 */
import { loadConfig } from "./config.js";
import { getOrCreateContext } from "./checkatrade/auth.js";
import { createMasterOsClient } from "./masterOs/client.js";
import { handleOpportunity } from "./classify.js";
import { logger } from "./logger.js";
import type { CheckatradeOpportunity } from "./checkatrade/types.js";

async function main(): Promise<void> {
  const [externalId, priceRaw, title, postcode] = process.argv.slice(2);
  if (!externalId || !priceRaw || !title) {
    throw new Error('usage: tsx src/acceptOne.ts <externalId> <price> "<title>" [postcode]');
  }

  const cfg = loadConfig();
  const masterOs = createMasterOsClient(cfg);

  const opportunity: CheckatradeOpportunity = {
    externalId,
    kind: "job",
    category: title,
    postcode,
    priceHint: Number(priceRaw),
    raw: { manual: true },
  };

  logger.info("MANUAL ACCEPT — running the full job path", {
    externalId,
    title,
    price: opportunity.priceHint,
    postcode,
    autoAccept: cfg.acceptance.autoAccept,
    slotDays: cfg.jobFilters.slotDays,
    minDateDaysAhead: cfg.jobFilters.minDateDaysAhead,
  });

  const { browser, page } = await getOrCreateContext(cfg);
  await handleOpportunity(opportunity, page, cfg, masterOs);
  await browser.close();
  logger.info("MANUAL ACCEPT — done (see lines above for the outcome)");
}

main().catch((err) => {
  logger.error("acceptOne failed", err);
  process.exit(1);
});
