/**
 * Verifies the Master OS preflight probe in both directions — a guard that
 * never fires is worse than no guard. Run with MASTER_OS_BASE_URL pointed at a
 * dead port to exercise the unhealthy path.
 *
 *   npx tsx src/preflightCheck.ts
 */
import { loadConfig } from "./config.js";
import { createMasterOsClient } from "./masterOs/client.js";
import { logger } from "./logger.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const masterOs = createMasterOsClient(cfg);
  const result = await masterOs.preflight();
  logger.info(`preflight against ${cfg.masterOs.baseUrl}`, result as unknown as Record<string, unknown>);
  console.log(result.ok ? "HEALTHY — jobs would be accepted" : "BLOCKED — jobs would be left on the board");
}

main().catch((err) => {
  logger.error("preflightCheck failed", err);
  process.exit(1);
});
