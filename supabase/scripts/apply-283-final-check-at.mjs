#!/usr/bin/env node
/**
 * Aplica a migração 283: `final_check_at` e `client_approval_requested_at`.
 *
 *   node supabase/scripts/apply-283-final-check-at.mjs            # confere e mostra
 *   node supabase/scripts/apply-283-final-check-at.mjs --aplicar  # aplica
 *
 * Usa o endpoint pg-meta do Kong com a SERVICE_ROLE_KEY, igual à 258.
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
const SH = { apikey: env.SERVICE_ROLE_KEY, authorization: "Bearer " + env.SERVICE_ROLE_KEY, "content-type": "application/json" };

async function q(query) {
  const r = await fetch(`${SB}/pg/query`, { method: "POST", headers: SH, body: JSON.stringify({ query }) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

const antes = await q(`
  select reference, status, updated_at
    from public.jobs
   where status = 'final_check' and deleted_at is null
   order by updated_at desc;
`);
console.log(`${antes.length} job(s) em final check agora (todos ficarão fora da primeira varredura):`);
for (const j of antes) console.log(`  ${j.reference}`);

if (!APLICAR) {
  console.log("\n[seco] nada aplicado. rode com --aplicar");
  process.exit(0);
}

const sql = readFileSync(join(RAIZ, "supabase", "migrations", "283_jobs_final_check_at.sql"), "utf8");
await q(sql);
console.log("\n1/3 migração 283 aplicada (colunas + trigger + carimbo dos atuais)");

await q("NOTIFY pgrst, 'reload schema';");
console.log("2/3 PostgREST recarregado");

const depois = await q(`
  select reference, final_check_at, client_approval_requested_at
    from public.jobs
   where status = 'final_check' and deleted_at is null
   order by reference;
`);
console.log("3/3 conferindo:");
for (const j of depois) {
  console.log(`  ${j.reference}  final_check_at=${j.final_check_at ? "ok" : "VAZIO"}  já pedido=${j.client_approval_requested_at ? "sim" : "NAO"}`);
}
console.log("\npronto.");
