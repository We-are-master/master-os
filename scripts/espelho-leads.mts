/**
 * Só a passada de leads do espelho do Zendesk (CRM, fase 3 e 4). A rotina de
 * 10 min já roda isto no fim de scripts/espelho-zendesk.mts; este arquivo é
 * para ensaiar e conferir à mão.
 *
 *   npx tsx scripts/espelho-leads.mts             ensaio: lista o que mudaria
 *   npx tsx scripts/espelho-leads.mts --aplicar   escreve no banco e no Zendesk
 *   --dias=N   leads Lost mexidos nos últimos N dias (padrão 14)
 *   --detalhe  uma linha por ticket
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
const { passarLeadsNoEspelho } = await import("../src/lib/crm/espelho-leads-rotina");

const aplicar = process.argv.includes("--aplicar");
const detalhe = process.argv.includes("--detalhe");
const dias = Number(process.argv.find((a) => a.startsWith("--dias="))?.split("=")[1] ?? 14);
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false } });

const r = await passarLeadsNoEspelho(sb, { aplicar, detalhe, dias });
console.log(`${aplicar ? "Aplicado" : "Ensaio"}: leads do CRM, janela de ${dias} dias para Lost.`);
console.log(Object.entries(r.conta).sort().map(([k, v]) => `  ${k}: ${v}`).join("\n") || "  nada a fazer");
if (r.linhas.length) console.log(r.linhas.join("\n"));
