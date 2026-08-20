/**
 * Separa por cômodo as fotos de um relatório que chegou com lista plana.
 *
 * Nasceu para o JOB-9450 (End of Tenancy de 19/08/2026): o parceiro preencheu
 * o template chapado, as 40 fotos vieram sem etiqueta, e o formulário de
 * limpeza da Housekeep tem treze campos com mínimo por cômodo. Sem cômodo, o
 * relatório não entra de jeito nenhum.
 *
 * Por padrão só MOSTRA a proposta e o que ainda falta. `--aplicar` grava, e
 * antes de gravar copia o envelope original para `.logs/`, porque foto de
 * parceiro é prova de serviço prestado.
 *
 *   npx tsx scripts/stefane-classificar-fotos.mts JOB-9450
 *   npx tsx scripts/stefane-classificar-fotos.mts JOB-9450 --aplicar
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";
import { classificarFotos, mapaPorComodo } from "../src/lib/stefane/classificar-fotos";
import { assinarFotos, urlsDeFoto } from "../src/lib/stefane/run-external-report";
import { buscarFormulario, faltasDeFoto } from "../src/lib/stefane/housekeep-api";

loadEnvLocal();

const referencia = process.argv[2];
const aplicar = process.argv.includes("--aplicar");
if (!referencia) {
  console.error("uso: npx tsx scripts/stefane-classificar-fotos.mts JOB-9450 [--aplicar]");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
);

const { data: job } = await supabase
  .from("jobs")
  .select("id, reference, title, client_name, partner_name, report_link, start_report, final_report")
  .eq("reference", referencia)
  .maybeSingle();

if (!job) {
  console.error(`job ${referencia} não existe`);
  process.exit(1);
}

console.log(`${job.reference} · ${job.title} · ${job.client_name} · parceiro ${job.partner_name}\n`);

const propostas: Record<"start_report" | "final_report", Record<string, string[]> | null> = {
  start_report: null,
  final_report: null,
};

for (const metade of ["start_report", "final_report"] as const) {
  const envelope = job[metade] as Record<string, unknown> | null;
  const rotulo = metade === "start_report" ? "ANTES" : "DEPOIS";
  if (!envelope) {
    console.log(`${rotulo}: sem relatório\n`);
    continue;
  }
  if (envelope.photos && !Array.isArray(envelope.photos)) {
    console.log(`${rotulo}: já está separado por cômodo, nada a fazer\n`);
    continue;
  }

  const urls = urlsDeFoto(envelope);
  if (urls.length === 0) {
    console.log(`${rotulo}: sem foto\n`);
    continue;
  }

  const assinadas = await assinarFotos(supabase, urls);
  if (assinadas.length !== urls.length) {
    console.log(`${rotulo}: ${urls.length} fotos no envelope mas só ${assinadas.length} assinaram. Parando.`);
    continue;
  }

  console.log(`${rotulo}: classificando ${urls.length} fotos...`);
  const r = await classificarFotos(assinadas);
  if (!r.ok) {
    console.log(`  falhou: ${r.motivo}\n`);
    continue;
  }

  const { mapa, duvidosas } = mapaPorComodo(r.fotos, urls);
  for (const [comodo, lista] of Object.entries(mapa).sort()) {
    const nota = comodo === "unknown" ? "  (fica no OS, não sobe para a plataforma)" : "";
    console.log(`  ${comodo.padEnd(14)} ${lista.length}${nota}`);
  }
  if (duvidosas) console.log(`  ${duvidosas} foto(s) o modelo não soube dizer o cômodo`);
  console.log();
  propostas[metade] = mapa;
}

/**
 * A conta que interessa: com esta proposta, o relatório passa na validação
 * deles? A resposta quase sempre é "quase", e o "quase" é a mensagem que se
 * manda ao parceiro no mesmo dia.
 */
const busca = await buscarFormulario(String(job.report_link));
if (busca.ok) {
  const contar = (m: Record<string, string[]> | null, envelope: unknown) =>
    m
      ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.length]))
      : { all: urlsDeFoto(envelope).length };

  const faltas = faltasDeFoto(busca.form, {
    antes: contar(propostas.start_report, job.start_report),
    depois: contar(propostas.final_report, job.final_report),
  });
  if (faltas.length === 0) {
    console.log("Com esta separação o relatório PASSA na validação da Housekeep.");
  } else {
    console.log("Mesmo separado, ainda falta para a Housekeep aceitar:");
    for (const f of faltas) console.log(`  ${f}`);
    console.log("\nÉ esta a lista para pedir ao parceiro, foto a foto, hoje.");
  }
} else {
  console.log(`não deu para conferir contra a Housekeep: ${busca.motivo}`);
}

if (!aplicar) {
  console.log("\n(nada foi gravado. rode com --aplicar para trocar o envelope)");
  process.exit(0);
}

const carimbo = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
mkdirSync(".logs", { recursive: true });
const backup = `.logs/fotos-antes-${job.reference}-${carimbo}.json`;
writeFileSync(backup, JSON.stringify({ start_report: job.start_report, final_report: job.final_report }, null, 2));
console.log(`\ncópia do original em ${backup}`);

const patch: Record<string, unknown> = {};
for (const metade of ["start_report", "final_report"] as const) {
  const mapa = propostas[metade];
  if (!mapa) continue;
  patch[metade] = { ...(job[metade] as Record<string, unknown>), photos: mapa };
}
if (Object.keys(patch).length === 0) {
  console.log("nada para gravar");
  process.exit(0);
}

const { error } = await supabase.from("jobs").update(patch).eq("id", job.id);
if (error) {
  console.error("falhou ao gravar:", error.message);
  process.exit(1);
}
console.log(`gravado: ${Object.keys(patch).join(", ")}`);
