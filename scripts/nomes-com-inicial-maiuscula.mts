/**
 * Arruma os nomes já gravados em CAIXA ALTA ou minúsculo (dono, 25/10/2026):
 * "ARVIN RAVINDRAN" vira "Arvin Ravindran". Mesma regra de `nomeProprio`, que
 * só mexe em nome todo maiúsculo ou todo minúsculo; "McDonald" fica como está.
 *
 *   npx tsx scripts/nomes-com-inicial-maiuscula.mts            # ENSAIO: lista, não grava
 *   npx tsx scripts/nomes-com-inicial-maiuscula.mts --aplicar  # grava
 *
 * Clientes (`clients.full_name`), o nome no job (`jobs.client_name`) e os leads
 * do site (`site_leads.full_name`). Só registros não apagados.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal();
const { nomeProprio } = await import("../src/lib/nome-proprio");

const aplicar = process.argv.includes("--aplicar");
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
  { auth: { persistSession: false } },
);

async function todos(tabela: string, coluna: string, apagado: boolean): Promise<Array<{ id: string; nome: string }>> {
  const linhas: Array<{ id: string; nome: string }> = [];
  for (let de = 0; ; de += 1000) {
    let q = sb.from(tabela).select(`id, ${coluna}`).not(coluna, "is", null).order("id").range(de, de + 999);
    if (apagado) q = q.is("deleted_at", null);
    const { data, error } = await q;
    if (error) throw new Error(`${tabela}: ${error.message}`);
    for (const r of (data ?? []) as unknown as Array<Record<string, string>>) linhas.push({ id: r.id, nome: r[coluna] });
    if ((data ?? []).length < 1000) break;
  }
  return linhas;
}

for (const [tabela, coluna, apagado] of [["clients", "full_name", true], ["jobs", "client_name", true], ["site_leads", "full_name", false]] as const) {
  const linhas = await todos(tabela, coluna, apagado);
  const mudar = linhas.map((l) => ({ ...l, novo: nomeProprio(l.nome) })).filter((l) => l.novo && l.novo !== l.nome);
  console.log(`\n${tabela}.${coluna}: ${mudar.length} de ${linhas.length} ${aplicar ? "arrumados" : "seriam arrumados"}`);
  for (const l of mudar.slice(0, 15)) console.log(`  ${l.nome}  →  ${l.novo}`);
  if (mudar.length > 15) console.log(`  … e mais ${mudar.length - 15}`);
  if (!aplicar) continue;
  let falhas = 0;
  for (const l of mudar) {
    const { error } = await sb.from(tabela).update({ [coluna]: l.novo }).eq("id", l.id);
    if (error) {
      falhas++;
      console.error(`  falhou ${l.id}: ${error.message}`);
    }
  }
  if (falhas) console.log(`  ${falhas} falharam`);
}
if (!aplicar) console.log("\nENSAIO: nada gravado. Rode com --aplicar para gravar.");
