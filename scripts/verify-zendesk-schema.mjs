#!/usr/bin/env node
/**
 * Verify Supabase schema columns required for Zendesk bands + Smart/Fixed pricing.
 *
 * Usage:
 *   node scripts/verify-zendesk-schema.mjs
 *   npm run verify:zendesk-schema
 *
 * Requires: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_URL + key)
 */

import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";

/** migration id → columns to probe via SELECT */
const REQUIRED_COLUMNS = [
  { migration: "076", table: "jobs", column: "hourly_client_rate" },
  { migration: "076", table: "jobs", column: "hourly_partner_rate" },
  { migration: "175", table: "service_catalog", column: "pricing_presets" },
  { migration: "175", table: "jobs", column: "catalog_pricing_preset_id" },
  { migration: "192", table: "account_service_prices", column: "preset_overrides" },
  { migration: "192", table: "jobs", column: "catalog_pricing_addon_ids" },
  { migration: "193", table: "partner_service_prices", column: "preset_overrides" },
  { migration: "202", table: "service_catalog", column: "zendesk_option_id" },
  { migration: "212", table: "jobs", column: "auto_assign_invited_partner_ids" },
  { migration: "212", table: "jobs", column: "auto_assign_expires_at" },
  { migration: "219", table: "service_catalog", column: "accepts_smart_price" },
  { migration: "219", table: "jobs", column: "catalog_band_label" },
];

async function probeColumn(supabase, table, column) {
  const { error } = await supabase.from(table).select(column).limit(1);
  if (!error) return { ok: true };
  const msg = error.message ?? String(error);
  if (/column|schema cache|does not exist|Could not find/i.test(msg)) {
    return { ok: false, error: msg };
  }
  return { ok: true, warn: msg };
}

async function main() {
  loadEnvLocal();

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY)");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const missing = [];
  const present = [];
  const warned = [];

  console.log("\n=== Zendesk pricing schema verification ===\n");

  for (const { migration, table, column } of REQUIRED_COLUMNS) {
    const result = await probeColumn(supabase, table, column);
    const label = `[${migration}] ${table}.${column}`;
    if (result.ok && !result.warn) {
      present.push(label);
      console.log(`OK   ${label}`);
    } else if (result.ok && result.warn) {
      warned.push({ label, warn: result.warn });
      console.log(`OK?  ${label} (probe warning: ${result.warn})`);
    } else {
      missing.push({ migration, table, column, error: result.error });
      console.log(`MISS ${label}`);
      console.log(`     ${result.error}`);
    }
  }

  const byMigration = new Map();
  for (const m of missing) {
    if (!byMigration.has(m.migration)) byMigration.set(m.migration, []);
    byMigration.get(m.migration).push(`${m.table}.${m.column}`);
  }

  console.log("\n=== Summary ===");
  console.log(`Present: ${present.length}/${REQUIRED_COLUMNS.length}`);
  console.log(`Missing: ${missing.length}`);

  if (missing.length) {
    console.log("\nApply these migrations in Supabase:");
    for (const [mig, cols] of [...byMigration.entries()].sort()) {
      console.log(`  Migration ${mig}: ${cols.join(", ")}`);
      console.log(`    → supabase/migrations/${mig}_*.sql`);
    }
    process.exit(1);
  }

  console.log("\nAll required columns are present.");
  if (warned.length) {
    console.log(`(${warned.length} column(s) had non-schema probe warnings — likely empty tables or RLS)`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
