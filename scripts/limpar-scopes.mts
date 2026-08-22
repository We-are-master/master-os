/**
 * Passa o `limparScope` nos jobs que já estão gravados.
 *
 *   npx tsx scripts/limpar-scopes.mts            ← dry run, mostra o diff
 *   npx tsx scripts/limpar-scopes.mts --gravar   ← grava
 *
 * A limpeza nova vale para todo job que nascer daqui pra frente, porque roda
 * no `/api/jobs`. Este script é para os que nasceram antes: em 22/08/2026, 21
 * jobs com horário solto no scope e 19 nomeando a conta que nos passou o
 * trabalho.
 *
 * Dry run é o padrão pelo mesmo motivo de sempre: o que este script edita é
 * texto que o parceiro lê, e não há desfazer.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";
import { limparScope } from "../src/lib/scope-limpo";

loadEnvLocal();

const gravar = process.argv.includes("--gravar");
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
);

const { data: contas } = await supabase.from("accounts").select("id, company_name");
const nomeDaConta = new Map((contas ?? []).map((c) => [c.id as string, String(c.company_name ?? "")]));

const { data: jobs, error } = await supabase
  .from("jobs")
  .select("id, reference, scope, client_id")
  .not("scope", "is", null);
if (error) throw new Error(error.message);

/** A conta de um job vem pelo cliente: `jobs` não guarda a conta. */
const clientIds = [...new Set((jobs ?? []).map((j) => j.client_id).filter(Boolean))] as string[];
const contaDoCliente = new Map<string, string>();
for (let i = 0; i < clientIds.length; i += 200) {
  const { data } = await supabase.from("clients").select("id, source_account_id").in("id", clientIds.slice(i, i + 200));
  for (const c of data ?? []) contaDoCliente.set(c.id as string, c.source_account_id as string);
}

/**
 * O original de tudo que for tocado, em disco, antes de qualquer escrita.
 *
 * Scope é texto escrito por gente: o morador descreveu o problema, o
 * escritório completou. Se a limpeza comer uma linha que importava, sem isto
 * não há de onde tirar de volta.
 */
const backup: { reference: string; scope: string }[] = [];

let mexidos = 0;
let inteiros = 0;
for (const j of jobs ?? []) {
  const conta = j.client_id ? nomeDaConta.get(contaDoCliente.get(j.client_id as string) ?? "") : undefined;
  /**
   * `manterJanela`: job antigo guarda a janela no scope, e para 46 deles essa
   * linha discorda do campo do job (31 em exatamente uma hora). Enquanto a
   * diferença não tiver explicação, ela é prova e não lixo. Job novo já nasce
   * sem ela, porque o `/api/jobs` limpa na entrada.
   */
  const limpo = limparScope(j.scope as string, {
    nomesProibidos: conta ? [conta] : [],
    manterJanela: true,
  });
  if (limpo === j.scope) continue;

  // Scope que sobra vazio fica como está: um job sem descrição nenhuma é pior
  // que um job com uma linha de lixo, e quem decide o que fazer é gente.
  if (!limpo) {
    console.log(`  ~ ${j.reference}: sobraria VAZIO, deixando como está`);
    inteiros++;
    continue;
  }

  mexidos++;
  backup.push({ reference: j.reference as string, scope: j.scope as string });
  const saiu = (j.scope as string)
    .split("\n")
    .filter((l) => !limpo.includes(l.trim()) && l.trim())
    .map((l) => l.trim());
  console.log(`  ${j.reference}: tira ${saiu.length} linha(s) → ${saiu.slice(0, 3).map((l) => `"${l.slice(0, 54)}"`).join(", ")}`);

  if (gravar) {
    const { error: e } = await supabase.from("jobs").update({ scope: limpo }).eq("id", j.id);
    if (e) console.log(`     ✗ falhou: ${e.message}`);
  }
}

if (gravar && backup.length > 0) {
  mkdirSync(".logs", { recursive: true });
  const arquivo = `.logs/scopes-antes-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.json`;
  writeFileSync(arquivo, JSON.stringify(backup, null, 1));
  console.log(`\noriginais guardados em ${arquivo}`);
}

console.log(
  `\n${gravar ? "GRAVADO" : "DRY RUN (nada foi alterado)"} · ${jobs?.length} jobs com scope · ` +
    `${mexidos} para limpar · ${inteiros} deixados inteiros`,
);
if (!gravar && mexidos > 0) console.log("Para gravar: --gravar\n");
