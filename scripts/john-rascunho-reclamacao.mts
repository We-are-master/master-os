/**
 * John, reclamações: só rascunho (dono, 10/11/2026). Regras em src/lib/john/rascunho-reclamacao.ts.
 *
 * Job em on hold por reclamação ganha um rascunho ao parceiro no journal (o parceiro não
 * vê) e um rascunho ao cliente em nota interna no ticket do job. Uma vez por hold e mais
 * uma quando o parceiro responde. Não manda nada a ninguém.
 *
 *   npx tsx scripts/john-rascunho-reclamacao.mts                       ensaio: lista
 *   npx tsx scripts/john-rascunho-reclamacao.mts --detalhe             ensaio com os textos
 *   npx tsx scripts/john-rascunho-reclamacao.mts --aplicar             escreve
 *
 * Desligado sem JOHN_RASCUNHO=1: sai sem ler nada. O fixfy-workers roda a cada 10 min
 * (scripts/workers/rotinas.mts).
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const arq of [".env.local", ".env"]) {
  try {
    for (const l of readFileSync(new URL(`../${arq}`, import.meta.url), "utf8").split("\n")) {
      const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
}
const { johnLigado, rodarJohn, zendeskDoJohn, llmDoJohn } = await import("../src/lib/john/rascunho-reclamacao");

if (!johnLigado()) {
  console.log("JOHN_RASCUNHO desligado: nada a fazer.");
  process.exit(0);
}

const aplicar = process.argv.includes("--aplicar");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false } });
const r = await rodarJohn(sb, {
  aplicar,
  zendesk: zendeskDoJohn(),
  llm: aplicar ? llmDoJohn() : null,
  detalhe: process.argv.includes("--detalhe"),
});
for (const l of r.linhas) console.log(l);
console.log(`${aplicar ? "Aplicado" : "Ensaio"}: ${r.escritos} rascunho(s) gravado(s). Nada foi enviado a cliente ou parceiro.`);
