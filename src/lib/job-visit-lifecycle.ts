import type { Job, JobVisit, PrimaryVisitDone } from "@/types/database";
import { isOpenVisit } from "@/lib/job-visit-day-rows";

/**
 * O job segue a visita ativa (dono, 22/10/2026).
 *
 * Toda visita nova (ou remarcada) que ainda não foi feita devolve o job ao ciclo:
 * JOB-9705 estava em Final review, ganhou a V3 para 23/10 e volta para Scheduled.
 * Daí em diante o job acompanha a visita ativa: visita começou → In progress;
 * relatório da última visita → Final review; e o resto do caminho é o de sempre.
 * Pagamento (fatura, pago ou não) é independente e nada aqui mexe nele.
 *
 * A data da visita 1 não se perde: vai para `primary_visit_done` (mig 337), o
 * mesmo registro que o Done da V1 já usa. O dia de trabalho do job passa a ser o
 * da visita ativa; se ficasse no dia 20/10, o marcador de atraso viraria o job
 * para Late e ele apareceria de novo no dia da V1.
 *
 * Puro, para o servidor e o teste usarem a mesma regra.
 */

/** Estágios depois do trabalho de campo: visita aberta devolve o job para Scheduled. */
export const JOB_STATUSES_REOPENED_BY_VISIT = new Set(["final_check", "need_attention", "awaiting_payment", "completed"]);

/** Estágios de campo: o job só acompanha a visita quando a V1 já foi feita. */
const FIELD = new Set(["scheduled", "late", "in_progress"]);

type VisitLike = Pick<
  JobVisit,
  "id" | "visit_index" | "status" | "scheduled_date" | "scheduled_start_at" | "scheduled_end_at" | "deleted_at"
>;

type JobLike = Pick<
  Job,
  "status" | "scheduled_date" | "scheduled_start_at" | "scheduled_end_at" | "expected_finish_at" | "primary_visit_done"
>;

export type JobFollowsVisit = {
  status: Job["status"];
  /** O que muda no job: status, dia de trabalho e, na primeira vez, a V1 guardada. */
  patch: Record<string, unknown>;
  visit: Pick<JobVisit, "id" | "visit_index">;
  reopened: boolean;
};

function startKey(v: VisitLike): string {
  return v.scheduled_start_at ?? (v.scheduled_date ? `${v.scheduled_date}T00:00:00` : "9999");
}

function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) ? ta === tb : a === b;
}

/** A visita que manda agora: a que está em andamento, senão a próxima marcada. */
export function activeVisit<T extends VisitLike>(visits: readonly T[]): T | null {
  const open = visits.filter((v) => isOpenVisit(v) && Boolean(v.scheduled_date));
  const inProgress = open.filter((v) => v.status === "in_progress");
  const pool = inProgress.length ? inProgress : open;
  return [...pool].sort((a, b) => startKey(a).localeCompare(startKey(b)) || a.visit_index - b.visit_index)[0] ?? null;
}

/**
 * Para onde o job vai pelas visitas, ou `null` quando nada muda.
 *
 *  - sem visita aberta: nada (fechar a última visita segue o caminho de sempre);
 *  - job cancelado, em espera, sem parceiro ou antes do campo: nada;
 *  - job em campo com a V1 ainda por fazer: nada, a V1 é o trabalho dele;
 *  - senão o job fica no status da visita ativa (Scheduled ou In progress), no dia dela.
 */
export function jobStatusFromVisits(
  job: JobLike,
  visits: readonly VisitLike[],
  opts?: { primaryDone?: boolean; now?: Date },
): JobFollowsVisit | null {
  const status = String(job.status);
  const reopen = JOB_STATUSES_REOPENED_BY_VISIT.has(status);
  if (!reopen && !FIELD.has(status)) return null;
  const v1Done = reopen || Boolean(job.primary_visit_done) || Boolean(opts?.primaryDone);
  if (!v1Done) return null;

  const active = activeVisit(visits);
  if (!active) return null;

  const sameSlot =
    (active.scheduled_date ?? null) === (job.scheduled_date ?? null) &&
    sameInstant(active.scheduled_start_at, job.scheduled_start_at) &&
    sameInstant(active.scheduled_end_at, job.scheduled_end_at);

  const target: Job["status"] =
    active.status === "in_progress" ? "in_progress" : status === "late" && sameSlot ? "late" : "scheduled";

  const patch: Record<string, unknown> = {};
  if (target !== status) patch.status = target;
  if (!sameSlot) {
    patch.scheduled_date = active.scheduled_date ?? null;
    patch.scheduled_start_at = active.scheduled_start_at ?? null;
    patch.scheduled_end_at = active.scheduled_end_at ?? null;
    patch.expected_finish_at = active.scheduled_end_at ?? null;
  }
  if (!job.primary_visit_done) {
    const v1: PrimaryVisitDone = {
      scheduled_date: job.scheduled_date ?? null,
      scheduled_start_at: job.scheduled_start_at ?? null,
      scheduled_end_at: job.scheduled_end_at ?? null,
      done_at: (opts?.now ?? new Date()).toISOString(),
    };
    patch.primary_visit_done = v1;
  }
  if (Object.keys(patch).length === 0) return null;
  return { status: target, patch, visit: { id: active.id, visit_index: active.visit_index }, reopened: reopen };
}

/** Final review não roda com visita pela frente: o job ainda tem trabalho de campo. */
export function hasOpenVisit(visits: readonly Pick<JobVisit, "status" | "deleted_at">[]): boolean {
  return visits.some((v) => isOpenVisit(v));
}
