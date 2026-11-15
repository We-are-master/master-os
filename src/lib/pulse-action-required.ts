/**
 * Os cartões de jobs do "Action required" da home: final review, sem parceiro, agendados.
 * Mora aqui para a tela e o JARVIS (`/api/jarvis/resumo`) contarem do mesmo jeito.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Os status que a home busca para os cartões. */
export const STATUS_DAS_ACOES = ["final_check", "scheduled", "late", "in_progress", "unassigned", "auto_assigning"] as const;

export const COLUNAS_DAS_ACOES =
  "id, reference, title, client_name, partner_name, status, client_price, extras_amount, final_report_submitted, final_report_approved_at, report_1_uploaded";

type JobDaAcao = { status: string; client_price: number | null; extras_amount: number | null };

export const valorDoJobDaAcao = (j: Pick<JobDaAcao, "client_price" | "extras_amount">) =>
  (Number(j.client_price) || 0) + (Number(j.extras_amount) || 0);

/** Sem banco: separa os jobs nos cartões da home. */
export function separarAcoes<T extends JobDaAcao>(jobs: T[]) {
  const revisao = jobs.filter((j) => j.status === "final_check");
  return {
    revisao,
    /** "waiting to invoice" do cartão de final review. */
    valorDaRevisao: revisao.reduce((t, j) => t + valorDoJobDaAcao(j), 0),
    semParceiro: jobs.filter((j) => j.status === "unassigned" || j.status === "auto_assigning"),
    agendados: jobs.filter((j) => j.status === "scheduled" || j.status === "late").length,
    emAndamento: jobs.filter((j) => j.status === "in_progress").length,
  };
}

/** A mesma busca da home, com qualquer cliente Supabase. */
export function buscarJobsDasAcoes(sb: SupabaseClient) {
  return sb.from("jobs").select(COLUNAS_DAS_ACOES).in("status", [...STATUS_DAS_ACOES]).is("deleted_at", null).limit(5000);
}
