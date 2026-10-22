import type { SupabaseClient } from "@supabase/supabase-js";
import { statusChangeOfficeTimerPatch } from "@/lib/office-job-timer";
import { statusChangePartnerTimerPatch } from "@/lib/partner-live-timer";
import { syncJobZendeskStatus } from "@/lib/zendesk-status-sync";
import { jobStatusFromVisits, type JobFollowsVisit } from "@/lib/job-visit-lifecycle";
import type { Job, JobVisit } from "@/types/database";

export type Actor = {
  userId?: string | null;
  userName?: string | null;
  /** Injeção para teste; no ar é o `syncJobZendeskStatus`. */
  syncZendesk?: (jobId: string, sb: SupabaseClient) => Promise<unknown>;
};

/**
 * Troca de status do job pelo servidor, do jeito que a tela troca: cronômetros
 * acertados, linha `status_changed` no histórico (a Command history e as métricas
 * de Final review leem dela) e o status do ticket do Zendesk acompanhando (o
 * gatilho do banco também faz; repetir é seguro). A escrita só vale se o job
 * ainda estiver no status lido, para duas rodadas não brigarem.
 */
export async function changeJobStatusServer(
  supabase: SupabaseClient,
  job: Job,
  newStatus: Job["status"],
  extraPatch: Record<string, unknown>,
  actor: Actor & { reason: string; metadata?: Record<string, unknown> },
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  const oldStatus = job.status;
  const changed = newStatus !== oldStatus;
  const patch: Record<string, unknown> = {
    ...extraPatch,
    ...(changed
      ? {
          status: newStatus,
          ...statusChangePartnerTimerPatch(job, newStatus),
          ...statusChangeOfficeTimerPatch(job, newStatus),
        }
      : {}),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("jobs")
    .update(patch)
    .eq("id", job.id)
    .eq("status", oldStatus)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "job status changed meanwhile" };
  if (!changed) return { ok: true, changed: false };

  try {
    await supabase.from("audit_logs").insert({
      entity_type: "job",
      entity_id: job.id,
      entity_ref: job.reference ?? null,
      action: "status_changed",
      field_name: "status",
      old_value: oldStatus,
      new_value: newStatus,
      user_id: actor.userId ?? null,
      user_name: actor.userName ?? null,
      metadata: { reason: actor.reason, ...(actor.metadata ?? {}) },
    });
  } catch {
    console.error("[job-status] audit failed", job.reference);
  }
  try {
    await (actor.syncZendesk ?? syncJobZendeskStatus)(job.id, supabase);
  } catch (e) {
    console.error("[job-status] zendesk sync failed", job.reference, e);
  }
  return { ok: true, changed: true };
}

export type FollowResult =
  | { ok: true; followed: false }
  | ({ ok: true; followed: true } & JobFollowsVisit)
  | { ok: false; error: string };

/**
 * Põe o job no passo da visita ativa (regra em `jobStatusFromVisits`). Chamado
 * quando uma visita nasce, é remarcada ou começa, depois do Done de uma visita e
 * pelo realinhamento dos dados antigos. Sem visita aberta, não faz nada.
 */
export async function followActiveVisit(
  supabase: SupabaseClient,
  jobId: string,
  actor: Actor & { primaryDone?: boolean; reason?: string },
): Promise<FollowResult> {
  const [{ data: jobRow, error: jobErr }, { data: visitRows, error: visitErr }] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", jobId).is("deleted_at", null).maybeSingle(),
    supabase.from("job_visits").select("*").eq("job_id", jobId).is("deleted_at", null),
  ]);
  if (jobErr) return { ok: false, error: jobErr.message };
  if (visitErr) return { ok: false, error: visitErr.message };
  const job = jobRow as Job | null;
  if (!job) return { ok: false, error: "Job not found" };

  const step = jobStatusFromVisits(job, (visitRows ?? []) as JobVisit[], { primaryDone: actor.primaryDone });
  if (!step) return { ok: true, followed: false };
  const statusAntes = job.status;

  const { status: _status, ...rest } = step.patch;
  void _status;
  const r = await changeJobStatusServer(supabase, job, step.status, rest, {
    userId: actor.userId,
    userName: actor.userName,
    reason: actor.reason ?? (step.reopened ? "visit_reopened_job" : "visit_followed"),
    syncZendesk: actor.syncZendesk,
    metadata: { visit_id: step.visit.id, visit_index: step.visit.visit_index },
  });
  if (!r.ok) return r;

  try {
    await supabase.from("audit_logs").insert({
      entity_type: "job",
      entity_id: job.id,
      entity_ref: job.reference,
      action: "visit_advanced",
      field_name: `visit_${step.visit.visit_index}`,
      user_id: actor.userId ?? null,
      user_name: actor.userName ?? null,
      metadata: {
        next_visit_id: step.visit.id,
        next_visit_index: step.visit.visit_index,
        scheduled_date: (step.patch.scheduled_date as string | null | undefined) ?? job.scheduled_date ?? null,
        reopened_from: step.reopened ? statusAntes : null,
      },
    });
  } catch {
    console.error("[visit-follow] audit failed", job.reference);
  }
  return { ok: true, followed: true, ...step };
}
