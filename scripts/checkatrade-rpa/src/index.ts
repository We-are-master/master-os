import { loadConfig } from "./config.js";
import { getOrCreateContext } from "./checkatrade/auth.js";
import { scrapeOpportunities } from "./checkatrade/dashboard.js";
import { createMasterOsClient } from "./masterOs/client.js";
import { handleOpportunity } from "./classify.js";
import { countJobsAcceptedToday } from "./dedupe/seenStore.js";
import { isWithinRunWindow } from "./time.js";
import { logger } from "./logger.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const masterOs = createMasterOsClient(cfg);
  const { browser, context, page } = await getOrCreateContext(cfg);

  let stopping = false;
  process.on("SIGINT", () => {
    logger.info("Shutting down (SIGINT)...");
    stopping = true;
  });
  process.on("unhandledRejection", (err) => {
    logger.error("Unhandled rejection (continuing)", err);
  });

  // Log the EFFECTIVE config up front so it's obvious which filters are live.
  logger.info("RPA started", {
    processKinds: cfg.processKinds,
    autoAccept: cfg.acceptance.autoAccept,
    maxJobsPerDay: cfg.acceptance.maxJobsPerDay || "unlimited",
    keywords: cfg.jobFilters.keywords.length ? cfg.jobFilters.keywords : "(none — all trades)",
    minValue: cfg.jobFilters.minValue,
    minDateDaysAhead: cfg.jobFilters.minDateDaysAhead,
    slotDays: cfg.jobFilters.slotDays,
    runDays: cfg.schedule.runDays,
    runHours: `${cfg.schedule.runStartHour}:00–${cfg.schedule.runEndHour}:00 ${cfg.schedule.timezone}`,
    pollEverySeconds: cfg.schedule.pollIntervalSeconds,
  });

  let lastInWindow: boolean | null = null;

  while (!stopping) {
    const inWindow = isWithinRunWindow(cfg.schedule);
    if (inWindow !== lastInWindow) {
      logger.info(inWindow ? "Inside run window — polling active" : "Outside run window — idling until hours resume");
      lastInWindow = inWindow;
    }

    if (inWindow) {
      try {
        const opportunities = await scrapeOpportunities(page);

        // Daily-cap pre-filter: once the cap is hit, skip JOBS for the rest of
        // the day but keep taking leads (they're free and uncapped).
        let toProcess = opportunities;
        if (cfg.acceptance.maxJobsPerDay > 0) {
          const acceptedToday = await countJobsAcceptedToday(cfg.schedule.timezone);
          if (acceptedToday >= cfg.acceptance.maxJobsPerDay) {
            const before = toProcess.length;
            toProcess = toProcess.filter((o) => o.kind !== "job");
            if (before !== toProcess.length) {
              logger.warn(`Daily job cap reached (${acceptedToday}/${cfg.acceptance.maxJobsPerDay}) — skipping jobs this cycle`);
            }
          }
        }

        logger.info(`Poll cycle: ${opportunities.length} opportunities (${toProcess.length} to consider)`);
        for (const o of toProcess) {
          if (stopping) break;
          await handleOpportunity(o, page, cfg, masterOs);
        }
      } catch (err) {
        // Network blip, selector break, whatever — log and try again next cycle.
        logger.error("Poll cycle failed", err);
      }
    }

    if (stopping) break;

    // Poll interval in seconds + a random jitter fraction, so the cadence isn't
    // a fixed, obviously-robotic beat.
    const baseMs = cfg.schedule.pollIntervalSeconds * 1000;
    const jitterMs = baseMs * cfg.schedule.pollJitter * Math.random();
    await sleep(baseMs + jitterMs);
  }

  await context.close();
  await browser.close();
  logger.info("Stopped.");
  process.exit(0);
}

main().catch((err) => {
  logger.error("Fatal error, exiting", err);
  process.exit(1);
});
