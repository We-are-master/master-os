/**
 * Ensaio do auto-assign com as regras novas (29/09/2026), SEM gravar nada.
 *
 *   npx tsx scripts/auto-assign-ensaio.mts            (próximos 14 dias)
 *   npx tsx scripts/auto-assign-ensaio.mts <job_id>   (um job)
 *
 * Mostra as vagas por dia e categoria e, para cada job, quem receberia a
 * oferta e o motivo de cada exclusão.
 */
import { readFileSync } from "node:fs";
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}
const { createServiceClient } = await import("../src/lib/supabase/service");
const { carregarCatalogo, carregarParceirosAtivos, carregarJobs, elegiveisParaJob, vagasPorDia, dataEmLondres } = await import("../src/lib/capacity");
const sb = createServiceClient();

const hoje = dataEmLondres(new Date());
const fim = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
const [{ data: cats }, { data: nomes }] = await Promise.all([
  sb.from("service_categories").select("id, name").order("sort"),
  sb.from("partners").select("id, company_name, contact_name").eq("status", "active"),
]);
const nomeCat = new Map((cats ?? []).map((c) => [c.id as string, c.name as string]));
const nomeParceiro = new Map((nomes ?? []).map((p) => [p.id as string, (p.company_name || p.contact_name || p.id) as string]));

console.log(`\nVAGAS POR DIA (${hoje} a ${fim})`);
for (const d of await vagasPorDia(sb, hoje, fim)) {
  const partes = Object.entries(d.categorias).map(([c, v]) => `${nomeCat.get(c) ?? c}: ${v.vagas} (${v.parceiros} parc., ${v.semParceiro} sem parc.)`);
  console.log(` ${d.data}  ${partes.join(" · ")}`);
}

const base = { catalogo: await carregarCatalogo(sb), parceiros: await carregarParceirosAtivos(sb), jobs: await carregarJobs(sb, hoje, fim) };
const idUnico = process.argv[2];
const q = sb.from("jobs").select("id, reference, title, status, partner_id, catalog_service_id, scheduled_date, scheduled_start_at, scheduled_end_at, partner_cost").is("deleted_at", null);
const { data: jobs } = idUnico ? await q.eq("id", idUnico) : await q.gte("scheduled_date", hoje).lte("scheduled_date", fim).not("status", "in", "(cancelled,deleted)").order("scheduled_date").limit(40);
const { paraJobDeEscala } = await import("../src/lib/capacity");
console.log(`\nJOBS (${(jobs ?? []).length})`);
const contagem = new Map<string, number>();
for (const j of jobs ?? []) {
  const job = paraJobDeEscala(j as never);
  if (!job.catalog_service_id) {
    console.log(` ${j.reference} ${j.title} · SEM SERVIÇO DO CATÁLOGO (fica fora do auto-assign)`);
    continue;
  }
  const e1 = await elegiveisParaJob(sb, job, "servico", base);
  const e2 = e1.elegiveis.length ? null : await elegiveisParaJob(sb, job, "categoria", base);
  for (const x of e1.excluidos) contagem.set(x.motivo, (contagem.get(x.motivo) ?? 0) + 1);
  const quem = (e1.elegiveis.length ? e1 : e2!).elegiveis.map((p) => nomeParceiro.get(p.id)).join(", ") || "ninguém";
  console.log(` ${j.reference} ${j.scheduled_date} ${j.title} [${j.status}${j.partner_id ? `, com ${nomeParceiro.get(j.partner_id) ?? "parceiro"}` : ""}] → ${e1.elegiveis.length ? "degrau 1" : "degrau 2"}: ${quem}`);
}
console.log("\nMOTIVOS DE EXCLUSÃO (degrau 1, somando todos os jobs):");
for (const [m, n] of [...contagem].sort((a, b) => b[1] - a[1])) console.log(`  ${m}: ${n}`);
