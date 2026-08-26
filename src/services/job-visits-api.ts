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

export async function apiCreateJobVisit(input: CreateJobVisitInput): Promise<JobVisit> {
  const { job_id: jobId, ...rest } = input;
  const visit = await callVisits(jobId, { method: "POST", body: JSON.stringify(rest) });
  if (!visit) throw new Error("Visit was not created");
  return visit;
}

export async function apiUpdateJobVisit(
  jobId: string,
  visitId: string,
  patch: Partial<Omit<JobVisit, "id" | "job_id" | "visit_index">> & { status?: JobVisitStatus },
): Promise<JobVisit> {
  const visit = await callVisits(jobId, { method: "PATCH", body: JSON.stringify({ ...patch, visitId }) });
  if (!visit) throw new Error("Visit was not updated");
  return visit;
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
