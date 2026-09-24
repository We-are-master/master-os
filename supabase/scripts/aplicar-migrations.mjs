#!/usr/bin/env node
/**
 * Aplica migrations no Postgres de produção pelo túnel do Studio (/pg/query).
 *
 *   node supabase/scripts/aplicar-migrations.mjs                 # só mostra quais tabelas já existem
 *   node supabase/scripts/aplicar-migrations.mjs 287 291 292     # aplica esses arquivos, na ordem
 *
 * Todas as migrations de marketing usam "if not exists": rodar duas vezes não
 * quebra nem duplica nada.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = {};
for (const arq of [".env.local", ".env"]) {
  try {
    for (const l of readFileSync(join(RAIZ, arq), "utf8").split("\n")) {
      const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
}
const chave = env.SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
async function q(query) {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/pg/query`, {
    method: "POST",
    headers: { apikey: chave, authorization: "Bearer " + chave, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : null;
}

const TABELAS = ["email_sequence_enrollments", "email_sequence_sends", "whatsapp_suppressions", "marketing_queue"];
const numeros = process.argv.slice(2);

if (!numeros.length) {
  const tem = await q(`select table_name from information_schema.tables where table_schema='public' and table_name in (${TABELAS.map((t) => `'${t}'`).join(",")})`);
  const achadas = new Set(tem.map((x) => x.table_name));
  for (const t of TABELAS) console.log(`${achadas.has(t) ? "✓ já existe" : "✗ falta    "}  ${t}`);
  process.exit(0);
}

const pasta = join(RAIZ, "supabase", "migrations");
for (const n of numeros) {
  const arq = readdirSync(pasta).find((f) => f.startsWith(`${n}_`));
  if (!arq) throw new Error(`migration ${n} não encontrada`);
  await q(readFileSync(join(pasta, arq), "utf8"));
  console.log(`✓ aplicada ${arq}`);
}
