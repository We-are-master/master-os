#!/usr/bin/env node
/**
 * Aplica a migração 289: faixas de 4 e 5+ quartos com 1 banheiro nas três
 * limpezas (end of tenancy, deep, after builders).
 *
 *   node supabase/scripts/apply-289-catalogo-limpeza-4-e-5-quartos.mjs            # mostra as faixas de hoje
 *   node supabase/scripts/apply-289-catalogo-limpeza-4-e-5-quartos.mjs --aplicar  # aplica e mostra o depois
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

async function faixas() {
  const rows = await q(`
    select name, e->>'label' as label, (e->>'fixed_price')::numeric as preco,
           (e->>'partner_cost')::numeric as parceiro, (e->>'sort_order')::numeric as ordem
      from service_catalog, jsonb_array_elements(pricing_presets) e
     where is_active and name in ('End of Tenancy Clean', 'Deep Clean', 'After Builders Clean')
     order by sort_order, ordem;
  `);
  let atual = "";
  for (const r of rows ?? []) {
    if (r.name !== atual) console.log(`\n${(atual = r.name)}`);
    console.log(`  ${String(r.label).padEnd(16)} £${r.preco} / £${r.parceiro}`);
  }
}

console.log(APLICAR ? "ANTES" : "HOJE");
await faixas();
if (!APLICAR) {
  console.log("\n(ensaio — use --aplicar)");
  process.exit(0);
}

await q(readFileSync(join(RAIZ, "supabase/migrations/289_catalogo_limpeza_4_e_5_quartos.sql"), "utf8"));
console.log("\nDEPOIS");
await faixas();
