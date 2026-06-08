#!/usr/bin/env node
/**
 * CLI backfill: mirror OS service_catalog + bands into Zendesk (no admin session).
 *
 * Usage:
 *   npx tsx scripts/run-zendesk-catalog-sync.mts
 *   npx tsx scripts/run-zendesk-catalog-sync.mts --dry-run
 *   npm run sync:zendesk-catalog
 *
 * Requires server env: Supabase service role + Zendesk API credentials.
 */

import { loadEnvLocal } from "./load-env-local.mjs";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  loadEnvLocal();
  const { backfillCatalogOptionsToZendesk } = await import(
    "../src/lib/zendesk-service-catalog-sync"
  );
  const { backfillAllBandsToZendesk } = await import("../src/lib/zendesk-service-bands-sync");

  console.log("\n=== Zendesk catalog sync (Type of Work) ===");
  if (dryRun) console.log("(dry-run — no Zendesk writes)\n");

  const tow = await backfillCatalogOptionsToZendesk({ dryRun });
  if (!tow.ok) {
    console.error("TOW sync failed:", tow.error ?? tow.skipped ?? "unknown");
    process.exit(1);
  }
  console.log("TOW stats:", tow.stats);
  if (tow.entries?.length) {
    console.log(`TOW plan entries: ${tow.entries.length}`);
  }

  console.log("\n=== Zendesk bands sync ===");
  const bands = await backfillAllBandsToZendesk({ dryRun });
  if (!bands.ok) {
    console.error("Bands sync failed:", bands.error ?? "unknown");
    for (const [id, r] of Object.entries(bands.results)) {
      if (!r.ok && !r.skipped) console.error(`  ${id}:`, r.error);
    }
    process.exit(1);
  }
  for (const [id, r] of Object.entries(bands.results)) {
    if (r.skipped) {
      console.log(`${id}: skipped (${r.skipped})`);
    } else {
      console.log(`${id}:`, r.stats ?? "ok");
    }
  }

  console.log("\nSync complete.");
  if (dryRun) {
    console.log("Re-run without --dry-run to push changes to Zendesk.");
  } else {
    console.log("Run: npm run audit:zendesk-catalog — to verify drift.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
