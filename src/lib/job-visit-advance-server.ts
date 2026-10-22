import type { SupabaseClient } from "@supabase/supabase-js";
import { jobStatusRank } from "@/lib/job-phases";
import { proximoPassoDasVisitas, type ProximoPasso, type VisitaParaAvancar } from "@/lib/job-visit-advance";
import { changeJobStatusServer, followActiveVisit } from "@/lib/job-visit-lifecycle-server";
import type { Job } from "@/types/database";

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
  args: {
    primary?: boolean;
    userId?: string | null;
    userName?: string | null;
    /** Injeção para teste; no ar é o sync de sempre. */
    syncZendesk?: (jobId: string, sb: SupabaseClient) => Promise<unknown>;
  },
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
    const r = await changeJobStatusServer(supabase, job, "in_progress", {}, {
      userId: args.userId,
      userName: args.userName,
      reason: "last_visit_done",
      syncZendesk: args.syncZendesk,
    });
    if (!r.ok) return { ok: false, error: r.error, status: 400 };
  }
  if (passo.kind !== "next_visit") return { ok: true, ...passo };

  /**
   * Ainda tem visita: o job segue a ativa, pelo mesmo caminho que uma visita nova
   * usa (22/10/2026): status, dia de trabalho, V1 guardada, histórico e Zendesk.
   */
  const proxima = passo.visit;
  const seguiu = await followActiveVisit(supabase, jobId, {
    primaryDone: true,
    userId: args.userId,
    userName: args.userName,
    reason: "visit_done_next_visit",
    syncZendesk: args.syncZendesk,
  });
  if (!seguiu.ok) return { ok: false, error: seguiu.error, status: 400 };
  return { ok: true, kind: "next_visit", visit: proxima };
}

/**
 * Relatório de uma visita extra entrou e a visita fechou (22/10/2026): ainda tem
 * visita pela frente → o job segue para ela; era a última → Final review, pelo
 * caminho que deixa histórico e o status do ticket em dia. Pagamento não muda.
 */
export async function jobAfterVisitReport(
  supabase: SupabaseClient,
  jobId: string,
  visit: { id: string; visit_index: number },
  deps?: { syncZendesk?: (jobId: string, sb: SupabaseClient) => Promise<unknown> },
): Promise<ResultadoDoAvanco> {
  const r = await avancarVisitas(supabase, jobId, { primary: false, userName: "Partner report", syncZendesk: deps?.syncZendesk });
  if (!r.ok || r.kind !== "finish") return r;
  const { data: atual } = await supabase.from("jobs").select("*").eq("id", jobId).maybeSingle();
  const job = atual as Job | null;
  if (job && ["scheduled", "late", "in_progress"].includes(String(job.status))) {
    const moved = await changeJobStatusServer(supabase, job, "final_check", { final_check_at: new Date().toISOString() }, {
      userName: "Partner report",
      reason: "last_visit_report",
      metadata: { visit_id: visit.id, visit_index: visit.visit_index },
      syncZendesk: deps?.syncZendesk,
    });
    if (!moved.ok) return { ok: false, error: moved.error, status: 400 };
  }
  return r;
}
