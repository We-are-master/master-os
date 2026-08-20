/**
 * Confere na API da Housekeep quais relatórios JÁ FORAM entregues, e carimba
 * no OS os que ele não sabia.
 *
 * Nasceu do JOB-9454 (20/08/2026). O envio tinha 124 fotos: a Stefane apertou
 * Submit, sondou por 30 segundos, não viu confirmação e gravou falha. O
 * servidor deles finalizou cinco minutos depois. Envio certo, registro errado,
 * e registro errado assim manda alguém refazer à mão um trabalho já feito.
 *
 * A causa foi corrigida (a espera agora é proporcional ao número de fotos),
 * mas a fila continha o estrago. Este script é a rede: pergunta à fonte, e
 * `submitted_at` da API deles é a única prova que este código aceita.
 *
 * Sem `--aplicar` só mostra.
 *
 *   npx tsx scripts/stefane-conferir-entregues.mts
 *   npx tsx scripts/stefane-conferir-entregues.mts --aplicar
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";
import { buscarFormulario } from "../src/lib/stefane/housekeep-api";

loadEnvLocal();
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
);
const aplicar = process.argv.includes("--aplicar");
/** Um mês para trás: link de relatório antigo some do lado deles (404). */
const DESDE = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? "2026-08-01";

const { data } = await sb
  .from("jobs")
  .select("id, reference, report_link, external_report_error")
  .ilike("report_link", "%housekeep%")
  .is("external_report_submitted_at", null)
  .gte("scheduled_date", DESDE)
  .order("scheduled_date", { ascending: false });

console.log(`${data?.length ?? 0} job(s) Housekeep que o OS acha que não foram entregues (desde ${DESDE})\n`);

const entregues: Array<{ id: string; reference: string; quando: string }> = [];
let sumiram = 0;
for (const j of data ?? []) {
  const r = await buscarFormulario(String(j.report_link));
  if (!r.ok) {
    // 404 é relatório que a Housekeep já não guarda: não dá para afirmar nada,
    // e afirmar na dúvida é como o placar ficou errado da primeira vez.
    if (r.sumiu) sumiram++;
    else console.log(`  ?          ${j.reference}  ${r.motivo.slice(0, 56)}`);
    continue;
  }
  if (r.form.submetidoEm) {
    console.log(
      `  ENTREGUE   ${j.reference}  na Housekeep em ${r.form.submetidoEm.slice(0, 19)}` +
        `  (o OS dizia: ${j.external_report_error ? "falhou" : "pendente"})`,
    );
    entregues.push({ id: String(j.id), reference: String(j.reference), quando: r.form.submetidoEm });
  } else {
    console.log(`  pendente   ${j.reference}  ${String(j.external_report_error ?? "").slice(0, 52)}`);
  }
}

if (sumiram) console.log(`\n${sumiram} link(s) que a Housekeep já não guarda: não dá para saber daqui.`);
console.log(`\n${entregues.length} job(s) entregues que o OS não sabia`);

if (!aplicar) {
  console.log("(nada foi gravado. rode com --aplicar para carimbar)");
  process.exit(0);
}
for (const e of entregues) {
  const { error } = await sb
    .from("jobs")
    .update({ external_report_submitted_at: e.quando, external_report_error: null, external_report_started_at: null })
    .eq("id", e.id);
  console.log(error ? `  falhou ${e.reference}: ${error.message}` : `  carimbado ${e.reference} = ${e.quando.slice(0, 19)}`);
}
