/**
 * Realinha os jobs que têm visita por fazer mas estão depois do campo
 * (Final review, Awaiting payment, Completed), pela regra de 22/10/2026: o job
 * segue a visita ativa. Caso que motivou: JOB-9705 em Final review com a V3 em 23/10.
 *
 *   npx tsx scripts/realinhar-jobs-com-visitas.mts            # ensaio: lista, não grava
 *   npx tsx scripts/realinhar-jobs-com-visitas.mts --aplicar  # grava
 *
 * Idempotente: usa a mesma regra do servidor (`followActiveVisit`), que não faz
 * nada quando o job já está no passo da visita ativa. Grava status, dia de
 * trabalho e a V1 em `primary_visit_done`, deixa `status_changed` no histórico e
 * acerta o status do ticket do Zendesk. Pagamento e faturas não são tocados.
 */
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal();
const APLICAR = process.argv.includes("--aplicar");

const [{ createServiceClient }, { jobStatusFromVisits, JOB_STATUSES_REOPENED_BY_VISIT }, { followActiveVisit }] = await Promise.all([
  import("../src/lib/supabase/service"),
  import("../src/lib/job-visit-lifecycle"),
  import("../src/lib/job-visit-lifecycle-server"),
]);
const supabase = createServiceClient();

const { data: abertas, error } = await supabase
  .from("job_visits")
  .select("job_id")
  .is("deleted_at", null)
  .in("status", ["scheduled", "in_progress"])
  .not("scheduled_date", "is", null);
if (error) throw new Error(error.message);
const ids = [...new Set((abertas ?? []).map((v) => (v as { job_id: string }).job_id))];

const { data: jobsRaw, error: jobsErr } = ids.length
  ? await supabase.from("jobs").select("*").in("id", ids).is("deleted_at", null)
  : { data: [], error: null };
if (jobsErr) throw new Error(jobsErr.message);

let mudam = 0;
for (const job of (jobsRaw ?? []) as Array<Record<string, unknown> & { id: string; reference: string; status: string }>) {
  const { data: visitas } = await supabase.from("job_visits").select("*").eq("job_id", job.id).is("deleted_at", null);
  const passo = jobStatusFromVisits(job as never, (visitas ?? []) as never);
  if (!passo) continue;
  mudam++;
  const de = `${job.status} ${job.scheduled_date ?? "sem data"}`;
  const para = `${passo.status} ${(passo.patch.scheduled_date as string | undefined) ?? job.scheduled_date ?? "sem data"}`;
  const marca = JOB_STATUSES_REOPENED_BY_VISIT.has(job.status) ? "reabre" : "segue";
  if (!APLICAR) {
    console.log(`· ${job.reference.padEnd(10)} ${marca}: ${de} → ${para} (V${passo.visit.visit_index})`);
    continue;
  }
  const r = await followActiveVisit(supabase, job.id, { userName: "Visit realign (script)", reason: "visit_realign_backfill" });
  console.log(`${r.ok ? "✓" : "✗"} ${job.reference.padEnd(10)} ${marca}: ${de} → ${para} (V${passo.visit.visit_index})${r.ok ? "" : ` · ${r.error}`}`);
}
console.log(`\n${mudam} job(s) ${APLICAR ? "realinhados" : "a realinhar"} · ${ids.length} job(s) com visita aberta${APLICAR ? "" : " · ensaio, nada gravado (use --aplicar)"}`);
