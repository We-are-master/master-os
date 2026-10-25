/**
 * Passa o scope dos jobs ABERTOS para o padrão Fixfy (WORK · PROPERTY · ACCESS ·
 * MATERIALS · NOTES), com o texto do cliente guardado em NOTES. Job concluído ou
 * cancelado não muda: o parceiro já trabalhou com aquele texto.
 *
 *   npx tsx scripts/scope-no-padrao.mts                 # ENSAIO: mostra antes e depois, não grava
 *   npx tsx scripts/scope-no-padrao.mts --aplicar       # grava
 *   npx tsx scripts/scope-no-padrao.mts --job JOB-9796  # só um job
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal();
const { scopeNoPadrao, jaNoPadrao } = await import("../src/lib/scope-padrao");
const { limparScope } = await import("../src/lib/scope-limpo");

const aplicar = process.argv.includes("--aplicar");
const umJob = process.argv[process.argv.indexOf("--job") + 1];
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
  { auth: { persistSession: false } },
);

let q = sb.from("jobs").select("id, reference, scope, account_id").is("deleted_at", null).not("scope", "is", null);
q = process.argv.includes("--job") ? q.eq("reference", umJob) : q.not("status", "in", "(completed,cancelled)");
const { data: jobs, error } = await q.order("created_at");
if (error) throw new Error(error.message);

const { data: contas } = await sb.from("accounts").select("id, company_name");
const nomeDaConta = new Map(((contas ?? []) as Array<{ id: string; company_name: string | null }>).map((c) => [c.id, c.company_name ?? ""]));

let mudam = 0;
for (const j of (jobs ?? []) as Array<{ id: string; reference: string; scope: string; account_id: string | null }>) {
  if (!j.scope.trim() || jaNoPadrao(j.scope)) continue;
  const novo = limparScope(await scopeNoPadrao(j.scope), { nomesProibidos: [nomeDaConta.get(j.account_id ?? "") ?? ""], manterJanela: true });
  if (!novo || novo === j.scope) continue;
  mudam++;
  console.log(`\n=== ${j.reference}\n--- antes\n${j.scope}\n--- depois\n${novo}`);
  if (aplicar) {
    const { error: e } = await sb.from("jobs").update({ scope: novo }).eq("id", j.id);
    console.log(e ? `FALHOU: ${e.message}` : "gravado");
  }
}
console.log(`\n${mudam} job(s) ${aplicar ? "passados para o padrão" : "mudariam (ENSAIO: nada gravado; --aplicar grava)"}.`);
