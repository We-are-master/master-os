import { loadConfig } from "./config.js";
import { getOrCreateContext, reLogin, SessionExpiredError } from "./checkatrade/auth.js";
import { CloudflareBlockedError, scrapeNewOnly, scrapeOpportunities } from "./checkatrade/dashboard.js";
import { createMasterOsClient } from "./masterOs/client.js";
import { handleOpportunity } from "./classify.js";
import { countJobsAcceptedToday } from "./dedupe/seenStore.js";
import { isWithinRunWindow } from "./time.js";
import { logger } from "./logger.js";
import { isPriority } from "./jobRules.js";
import { rodarConclusoes } from "./express/completion.js";

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
    maxLeadsPerCycle: cfg.acceptance.maxLeadsPerCycle,
    keywords: cfg.jobFilters.keywords.length ? cfg.jobFilters.keywords : "(none — all trades)",
    excludeKeywords: cfg.jobFilters.excludeKeywords.length ? cfg.jobFilters.excludeKeywords : "(none)",
    minValue: cfg.jobFilters.minValue,
    nonCertMinValue: cfg.jobFilters.nonCertMinValue,
    highValueMin: cfg.jobFilters.highValueMin,
    minDateDaysAhead: cfg.jobFilters.minDateDaysAhead,
    slotDays: `${cfg.jobFilters.slotDays} (EICR e alto valor: qualquer dia, 1d)`,
    runDays: cfg.schedule.runDays,
    runHours: `${cfg.schedule.runStartHour}:00–${cfg.schedule.runEndHour}:00 ${cfg.schedule.timezone}`,
    pollEverySeconds: cfg.schedule.pollIntervalSeconds,
    leadsEverySeconds: cfg.schedule.leadsIntervalSeconds,
    deepScanEveryMinutes: cfg.schedule.deepScanMinutes,
    completion: `${cfg.completion.mode} (max ${cfg.completion.maxPerCycle}/ciclo)`,
  });

  let lastInWindow: boolean | null = null;
  /**
   * Três relógios, a pedido do dono (17/08/2026): o ciclo normal vira uma
   * passada RÁPIDA só nos New do topo do board de jobs; os leads entram na
   * passada a cada LEADS_INTERVAL (novo lead também nasce New no topo — o
   * resto do board já está todo Interested e contactado); e a varredura
   * COMPLETA (placar da TV, dedupe, conclusões do Express) vira o deep scan
   * de DEEP_SCAN_MINUTES em DEEP_SCAN_MINUTES. Zerados para o primeiro ciclo
   * ser um deep scan: acordar com o quadro completo, e só então acelerar.
   */
  let lastLeadsAt = 0;
  let lastDeepAt = 0;
  /**
   * Batimento: o fast pass vazio não loga (senão o log vira metralhadora),
   * mas log mudo por 10 minutos é como a TV do escritório declara o robô
   * morto — "RUBEN · ALERT" com ele caçando normalmente. Uma linha a cada 5
   * minutos resume o silêncio e mantém o atestado de vida honesto.
   */
  let passesCalados = 0;
  let ultimoBatimento = Date.now();
  // Bloqueios Cloudflare consecutivos — cada um aumenta o cool-off (5, 10,
  // 15, 20 min). Insistir na cadência normal só mantém o flag quente.
  let cfBlocks = 0;
  // Ciclos seguidos com o browser morto — 2 = fatal, sai e o launchd renasce.
  let browserMorto = 0;

  while (!stopping) {
    const inWindow = isWithinRunWindow(cfg.schedule);
    if (inWindow !== lastInWindow) {
      logger.info(inWindow ? "Inside run window — polling active" : "Outside run window — idling until hours resume");
      lastInWindow = inWindow;
    }

    if (inWindow) {
      const cycleStartedAt = Date.now();
      const deepDue = cycleStartedAt - lastDeepAt >= cfg.schedule.deepScanMinutes * 60_000;
      const leadsDue = cycleStartedAt - lastLeadsAt >= cfg.schedule.leadsIntervalSeconds * 1_000;
      try {
        /**
         * Conclusões em TODO ciclo, não só no deep: "aprovou, sobe" é o
         * modelo (igual Housekeep), e prender a fila ao deep scan fazia o
         * job aprovado esperar até 30 minutos. A fila é um GET barato no OS
         * e quase sempre volta vazia; quando tem item, concluir é o
         * trabalho mais valioso do ciclo. Nunca lança.
         */
        await rodarConclusoes(page, cfg, masterOs);

        let opportunities;
        if (deepDue) {
          opportunities = await scrapeOpportunities(page);
          lastDeepAt = cycleStartedAt;
          lastLeadsAt = cycleStartedAt;
        } else {
          opportunities = await scrapeNewOnly(page, "jobs");
          if (leadsDue) {
            opportunities.push(...(await scrapeNewOnly(page, "leads")));
            lastLeadsAt = cycleStartedAt;
          }
        }

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

        // ── Express jobs first, always ───────────────────────────────────
        // A job is contested and money-bearing: measured 2026-07-28, a "New"
        // Express job was taken by another trade within ~2 minutes. A lead is
        // neither — nobody else can take it from us by responding faster.
        // Processing in board order meant a queue of leads could sit in front
        // of a job that was evaporating.
        toProcess = [...toProcess].sort((a, b) =>
          a.kind === b.kind ? 0 : a.kind === "job" ? -1 : 1,
        );

        // ── EICR and top payers to the very front ────────────────────────
        // Ordering by kind alone wasn't enough: a £204 EICR could sit behind
        // three £55 tasks while the ~2 minutes it survives run out. Judged
        // from the CARD (title + earnings) — all we have before a page load.
        const jobs = toProcess
          .filter((o) => o.kind === "job")
          .sort((a, b) => {
            const pa = isPriority(a.category, a.priceHint, cfg.jobFilters.highValueMin) ? 1 : 0;
            const pb = isPriority(b.category, b.priceHint, cfg.jobFilters.highValueMin) ? 1 : 0;
            if (pa !== pb) return pb - pa;
            return (b.priceHint ?? 0) - (a.priceHint ?? 0); // then richest first
          });
        // ── Bound the leads per cycle ────────────────────────────────────
        // Each lead costs ~28s (open detail, express interest, read, write),
        // so a 12-lead backlog blinds the board for ~6 minutes — long enough
        // to miss the next job, which is what the ordering above prevents.
        // Deferred leads are NOT marked seen; the next cycle picks them up.
        const leads = toProcess.filter((o) => o.kind === "lead");
        const leadsThisCycle = leads.slice(0, cfg.acceptance.maxLeadsPerCycle);
        const deferred = leads.length - leadsThisCycle.length;
        const queue = [...jobs, ...leadsThisCycle];

        cfBlocks = 0;
        browserMorto = 0;
        // Scrape time matters: the sleep below is only part of the gap between
        // checks, and Express jobs get taken by other trades within minutes.
        // Log the real cost so the true cadence is measurable, not guessed.
        const scrapeMs = Date.now() - cycleStartedAt;
        if (!deepDue && opportunities.length === 0) passesCalados += 1;
        if (Date.now() - ultimoBatimento >= 5 * 60_000) {
          if (passesCalados > 0) {
            logger.info(`Alive: ${passesCalados} quiet fast pass(es) in the last 5m — nothing New on the board`);
          }
          passesCalados = 0;
          ultimoBatimento = Date.now();
        }
        if (deepDue || opportunities.length > 0) {
          logger.info(
            `${deepDue ? "Deep scan" : "Fast pass"}: ${opportunities.length} opportunities — ${jobs.length} job(s), ${leadsThisCycle.length} lead(s) this pass` +
              (deferred > 0 ? `, ${deferred} lead(s) deferred to next cycle` : "") +
              ` — scrape took ${(scrapeMs / 1000).toFixed(1)}s`,
          );
        }
        // Don't touch anything if the destination is down. For a JOB the
        // accept is irreversible; for a LEAD, expressing interest flips it off
        // "New", so the board scraper never returns it again and the contact
        // is lost even though nothing was recorded. Skipping the pass costs
        // one cycle — nothing here is marked seen.
        if (queue.length > 0) {
          const health = await masterOs.preflight();
          if (!health.ok) {
            logger.error(
              `SKIPPING this pass — Master OS ${health.detail}. ` +
                `${queue.length} opportunit(y/ies) left untouched on the board; will retry next cycle.`,
            );
            queue.length = 0;
          }
        }

        for (const o of queue) {
          if (stopping) break;
          await handleOpportunity(o, page, cfg, masterOs);
        }
      } catch (err) {
        if (err instanceof SessionExpiredError) {
          // Checkatrade logged us out mid-run. Recover in place; the next
          // cycle (normal cadence) scrapes with the fresh session.
          logger.warn("Checkatrade session expired mid-run — logging in again");
          try {
            await reLogin(page, context, cfg);
          } catch (loginErr) {
            logger.error("Re-login failed — will retry next cycle", loginErr);
          }
        } else if (err instanceof CloudflareBlockedError) {
          // Loud and specific: silent-zero cycles against the block page were
          // exactly how jobs got missed. Cool off progressively — hammering
          // the block page every 40s keeps the rate-limit flag hot.
          cfBlocks += 1;
          const backoffMin = Math.min(20, 5 * cfBlocks);
          logger.error(`CLOUDFLARE BLOCK #${cfBlocks} — esfriando ${backoffMin} min antes do próximo ciclo`);
          await sleep(backoffMin * 60_000);
        } else if (/target page, context or browser has been closed|browser has been disconnected/i.test(String(err))) {
          // O browser MORREU (crash do Chromium, macOS matou no idle da
          // madrugada) e este loop reusa a mesma page para sempre — foi assim
          // que o Ruben passou 18/08 inteiro (07:00–16:30) errando a cada 12s
          // sem se recuperar, enquanto o dono pegava job na mão. Não há
          // conserto in-place que valha o risco: sai com erro e o launchd
          // (KeepAlive, ThrottleInterval 60s) renasce o processo com browser
          // zero-quilômetro em um minuto.
          browserMorto += 1;
          if (browserMorto >= 2) {
            logger.error("Browser is DEAD (2 cycles in a row) — exiting so launchd restarts us fresh");
            process.exit(1);
          }
          logger.error("Poll cycle failed — browser possibly dead, one more cycle to confirm", err);
        } else {
          // Network blip, selector break, whatever — log and try again next cycle.
          logger.error("Poll cycle failed", err);
        }
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
