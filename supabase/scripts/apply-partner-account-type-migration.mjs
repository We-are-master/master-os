#!/usr/bin/env node
/**
 * Apply migration 247 (partners.wizard_completed_at + partners.account_type).
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node supabase/scripts/apply-partner-account-type-migration.mjs
 *
 * Or add DATABASE_URL to .env.local (gitignored) and run without prefix.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadEnvLocal } from "../../scripts/load-env-local.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "migrations");

const files = ["247_partner_account_type_wizard.sql"];

async function main() {
  loadEnvLocal();
  const databaseUrl =
    process.env.DATABASE_URL?.trim() ||
    process.env.SUPABASE_DB_URL?.trim() ||
    process.env.DIRECT_URL?.trim();
  if (!databaseUrl) {
    console.error("DATABASE_URL (or SUPABASE_DB_URL / DIRECT_URL) is required to apply SQL migrations.");
    console.error("Paste the Supabase Postgres connection string, then re-run:");
    console.error("  DATABASE_URL=... node supabase/scripts/apply-partner-account-type-migration.mjs");
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      console.log(`Applying ${file}...`);
      await client.query(sql);
    }
    console.log("Reloading PostgREST schema...");
    await client.query("NOTIFY pgrst, 'reload schema';");
    console.log("Done — wizard_completed_at + account_type are live.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
