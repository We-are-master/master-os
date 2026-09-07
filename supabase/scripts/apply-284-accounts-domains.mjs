#!/usr/bin/env node
/**
 * Aplica a migração 284: `accounts.domains`.
 *
 *   node supabase/scripts/apply-284-accounts-domains.mjs            # confere e mostra
 *   node supabase/scripts/apply-284-accounts-domains.mjs --aplicar  # aplica
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const APLICAR = process.argv.includes("--aplicar");

const env = {};
for (const arq of [".env.local", ".env"]) {
  try {
    for (const l of readFileSync(join(RAIZ, arq), "utf8").split("\n")) {
      const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
}
const SB = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const SH = {
  apikey: env.SERVICE_ROLE_KEY,
  authorization: "Bearer " + env.SERVICE_ROLE_KEY,
  "content-type": "application/json",
};

async function q(query) {
  const r = await fetch(`${SB}/pg/query`, { method: "POST", headers: SH, body: JSON.stringify({ query }) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : null;
}

const jaTem = await q(`
  select count(*)::int as n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'accounts' and column_name = 'domains';
`);
console.log(`coluna domains existe: ${jaTem?.[0]?.n > 0 ? "sim" : "não"}`);

if (!APLICAR) {
  const contas = await q(`
    select company_name, email, lower(split_part(email, '@', 2)) as dominio
      from public.accounts where deleted_at is null order by company_name;
  `);
  console.log("\no que o seed gravaria:");
  for (const c of contas ?? []) console.log(`  ${String(c.company_name).padEnd(24)} ${c.dominio ?? "—"}`);
  console.log("\n(ensaio — use --aplicar)");
  process.exit(0);
}

const sql = readFileSync(join(RAIZ, "supabase/migrations/284_accounts_domains.sql"), "utf8");
await q(sql);

const depois = await q(`
  select company_name, domains from public.accounts where deleted_at is null order by company_name;
`);
console.log("\ndepois:");
for (const c of depois ?? []) {
  console.log(`  ${String(c.company_name).padEnd(24)} ${JSON.stringify(c.domains)}`);
}
