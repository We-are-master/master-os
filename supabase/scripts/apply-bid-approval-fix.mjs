#!/usr/bin/env node
/**
 * Apply bid-approval DB fixes (migrations 113, 167, 168, 170) when DATABASE_URL is set.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node supabase/scripts/apply-bid-approval-fix.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "migrations");

const files = [
  "113_approve_quote_bid_rpc.sql",
  "167_quotes_bidding_started_at.sql",
  "168_quotes_bidding_started_from_audit.sql",
  "170_quotes_bidding_started_backfill_null.sql",
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error("DATABASE_URL is required to apply SQL migrations.");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      console.log(`Applying ${file}...`);
      await client.query(sql);
    }
    console.log("Reloading PostgREST schema...");
    await client.query("NOTIFY pgrst, 'reload schema';");
    console.log("Done.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
