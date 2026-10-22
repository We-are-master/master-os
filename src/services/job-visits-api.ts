import type { CreateJobVisitInput } from "@/services/job-visits";
import type { JobVisit, JobVisitStatus } from "@/types/database";

/**
 * Escrita de visita pela rota `/api/jobs/[id]/visits`, e não direto no Supabase.
 *
 * A tela não é a única porta da tabela, mas é a porta principal: mandando a
 * escrita pelo servidor, o gate ("só nasce a próxima quando a anterior fechou"),
 * o audit na Command history e a autoria (`created_by` / `updated_by`) valem
 * para todo mundo que usa o card. Leitura continua direta — `listJobVisits`.
 */

async function callVisits(jobId: string, init: RequestInit): Promise<JobVisit | null> {
  const res = await fetch(`/api/jobs/${jobId}/visits`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const payload = (await res.json().catch(() => ({}))) as { visit?: JobVisit; error?: string };
  if (!res.ok) throw new Error(payload.error || `Visit request failed (${res.status})`);
  return payload.visit ?? null;
}

type AvisoDaVisita = { ok: boolean; skipped?: string; error?: string };

/** O job seguiu a visita (22/10/2026): para qual status e qual visita. */
export type JobFollowedVisit = { ok: boolean; followed?: boolean; status?: string; reopened?: boolean; visit?: { visit_index: number } } | null;

/** Cria e diz quem foi avisado: o parceiro da visita e o cliente, no ticket do job. */
export async function apiCreateJobVisit(
  input: CreateJobVisitInput,
): Promise<{
  visit: JobVisit;
  partnerNotified: AvisoDaVisita | null;
  clientNotified: AvisoDaVisita | null;
  /** Visita que fechou junto (job em andamento): o índice dela e para onde o job foi. */
  closedVisitIndex: number | null;
  advanced: { ok: boolean; kind?: string; visit?: { visit_index: number; scheduled_date?: string | null } } | null;
  followed: JobFollowedVisit;
}> {
  const { job_id: jobId, ...rest } = input;
  const res = await fetch(`/api/jobs/${jobId}/visits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rest),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    visit?: JobVisit;
    error?: string;
    notified?: AvisoDaVisita;
    clientNotified?: AvisoDaVisita;
    closedVisitIndex?: number | null;
    advanced?: { ok: boolean; kind?: string; visit?: { visit_index: number; scheduled_date?: string | null } } | null;
    followed?: JobFollowedVisit;
  };
  if (!res.ok) throw new Error(payload.error || `Visit request failed (${res.status})`);
  if (!payload.visit) throw new Error("Visit was not created");
  return {
    visit: payload.visit,
    partnerNotified: payload.notified ?? null,
    clientNotified: payload.clientNotified ?? null,
    closedVisitIndex: payload.closedVisitIndex ?? null,
    advanced: payload.advanced ?? null,
    followed: payload.followed ?? null,
  };
}

export async function apiUpdateJobVisit(
  jobId: string,
  visitId: string,
  patch: Partial<Omit<JobVisit, "id" | "job_id" | "visit_index">> & { status?: JobVisitStatus },
): Promise<JobVisit & { followed?: JobFollowedVisit }> {
  const res = await fetch(`/api/jobs/${jobId}/visits`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...patch, visitId }),
  });
  const payload = (await res.json().catch(() => ({}))) as { visit?: JobVisit; error?: string; followed?: JobFollowedVisit };
  if (!res.ok) throw new Error(payload.error || `Visit request failed (${res.status})`);
  if (!payload.visit) throw new Error("Visit was not updated");
  return { ...payload.visit, followed: payload.followed ?? null };
}

/** Soft delete. O id vai na query string, que DELETE com corpo não é confiável. */
export async function apiDeleteJobVisit(jobId: string, visitId: string): Promise<void> {
  const res = await fetch(`/api/jobs/${jobId}/visits?visitId=${encodeURIComponent(visitId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || `Visit delete failed (${res.status})`);
  }
}
