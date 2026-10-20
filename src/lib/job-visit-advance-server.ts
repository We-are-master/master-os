import type { SupabaseClient } from "@supabase/supabase-js";
import { jobStatusRank } from "@/lib/job-phases";
import { proximoPassoDasVisitas, type ProximoPasso, type VisitaParaAvancar } from "@/lib/job-visit-advance";
import type { Job, PrimaryVisitDone } from "@/types/database";

/** Estágios em que o job ainda está "em campo": só esses voltam para Scheduled. */
const EM_CAMPO = new Set(["scheduled", "late", "in_progress"]);

export type ResultadoDoAvanco = ({ ok: true } & ProximoPasso) | { ok: false; error: string; status: number };

/**
 * Leva o job para o próximo passo depois que uma visita terminou (19/10/2026).
 *
 *  - ainda tem visita marcada → o job fica Scheduled com a data da próxima, e a
 *    visita 1 guarda em `jobs.primary_visit_done` a data em que foi feita;
 *  - era a última → `finish`: a tela leva para Final review pelo caminho de sempre.
 *
 * Um lugar só, usado pelo Done (`/visits/advance`) e pelo Add visit, que fecha a
 * visita em andamento quando outra é marcada.
 */
export async function avancarVisitas(
  supabase: SupabaseClient,
  jobId: string,
  args: { primary?: boolean; userId?: string | null; userName?: string | null },
): Promise<ResultadoDoAvanco> {
  const [{ data: jobRow }, { data: visitRows }] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", jobId).maybeSingle(),
    supabase.from("job_visits").select("*").eq("job_id", jobId).is("deleted_at", null),
  ]);
  const job = jobRow as Job | null;
  if (!job) return { ok: false, error: "Job not found", status: 404 };
  const visits = (visitRows ?? []) as VisitaParaAvancar[];

  const jaFeita = job.primary_visit_done ?? null;
  const primaryDone = Boolean(args.primary) || Boolean(jaFeita) || jobStatusRank(job.status) >= 40;
  const passo = proximoPassoDasVisitas({ primaryDone, visits });

  if (passo.kind === "finish" && jaFeita && (job.status === "scheduled" || job.status === "late")) {
    /**
     * A última visita foi feita, mas o job está Scheduled porque o Done da V1 o
     * devolveu para a próxima visita. Final review só sai de In progress (regra do
     * `canAdvanceJob`), então o job volta ao estágio de campo, que é onde ele está.
     */
    const { error } = await supabase.from("jobs").update({ status: "in_progress" }).eq("id", jobId);
    if (error) return { ok: false, error: error.message, status: 400 };
  }
  if (passo.kind !== "next_visit") return { ok: true, ...passo };

  const proxima = passo.visit;
  const patch: Record<string, unknown> = {
    scheduled_date: proxima.scheduled_date ?? null,
    scheduled_start_at: proxima.scheduled_start_at ?? null,
    scheduled_end_at: proxima.scheduled_end_at ?? null,
    expected_finish_at: proxima.scheduled_end_at ?? null,
  };
  if (EM_CAMPO.has(String(job.status))) patch.status = "scheduled";
  if (!jaFeita) {
    const v1: PrimaryVisitDone = {
      scheduled_date: job.scheduled_date ?? null,
      scheduled_start_at: job.scheduled_start_at ?? null,
      scheduled_end_at: job.scheduled_end_at ?? null,
      done_at: new Date().toISOString(),
    };
    patch.primary_visit_done = v1;
  }

  const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
  if (error) return { ok: false, error: error.message, status: 400 };

  try {
    await supabase.from("audit_logs").insert({
      entity_type: "job",
      entity_id: job.id,
      entity_ref: job.reference,
      action: "visit_advanced",
      field_name: `visit_${proxima.visit_index}`,
      user_id: args.userId ?? null,
      user_name: args.userName ?? null,
      metadata: { next_visit_id: proxima.id, next_visit_index: proxima.visit_index, scheduled_date: proxima.scheduled_date ?? null },
    });
  } catch {
    console.error("visit advance audit failed");
  }
  return { ok: true, kind: "next_visit", visit: proxima };
}
