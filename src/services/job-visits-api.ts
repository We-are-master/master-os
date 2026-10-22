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

/**
 * Remover uma visita (22/10/2026): sempre pergunta antes, e na hora tira do
 * self-bill do parceiro dela (o servidor recusa se o documento já foi pago), do
 * total do job (gatilho da mig 274) e da fatura do cliente (o valor da fatura
 * acompanha o total do job). Devolve `false` quando a pessoa desistiu.
 */
export async function confirmAndRemoveJobVisit(
  jobId: string,
  visit: { id: string; visit_index: number; partner_name?: string | null; partner_cost?: number | null; client_price?: number | null },
  opts?: { confirm?: (message: string) => boolean },
): Promise<boolean> {
  const quem = visit.partner_name?.trim() || "the partner";
  const custo = Number(visit.partner_cost ?? 0);
  const cliente = Number(visit.client_price ?? 0);
  const gbp = (n: number) => `£${n.toFixed(2)}`;
  const linhas = [
    `Remove visit ${visit.visit_index}${visit.partner_name?.trim() ? ` (${visit.partner_name.trim()})` : ""}?`,
    "",
    `It comes off ${quem}'s self-bill now${custo > 0 ? ` (${gbp(custo)})` : ""}.`,
    cliente > 0 ? `The job total and the client invoice go down by ${gbp(cliente)}.` : "The client invoice does not change.",
    "This cannot be undone.",
  ];
  const pergunta = opts?.confirm ?? ((m: string) => window.confirm(m));
  if (!pergunta(linhas.join("\n"))) return false;

  await apiDeleteJobVisit(jobId, visit.id);
  // A fatura acompanha o total do job, que o gatilho já recalculou sem a visita.
  const [{ getJob }, { bumpLinkedInvoiceAmountsToJobSchedule }] = await Promise.all([
    import("@/services/jobs"),
    import("@/lib/sync-invoice-amount-from-job"),
  ]);
  const atual = await getJob(jobId);
  if (atual) await bumpLinkedInvoiceAmountsToJobSchedule(atual);
  return true;
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
