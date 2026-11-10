import type { SupabaseClient } from "@supabase/supabase-js";
import { visitCountsForPartnerPayout } from "@/lib/job-visit-rollup";
import type { JobVisit } from "@/types/database";

export type ValorFinalDoParceiro = {
  /** Mão de obra: visita 1 (o job) + visitas extras dele já feitas. */
  labour: number;
  materials: number;
  /** Quantas visitas extras entraram. */
  extraVisits: number;
  total: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * O que o parceiro recebe por este job, pela mesma regra do self-bill (dono,
 * 10/11/2026: "no e-mail de job completed para o partner ir o valor total
 * atualizado a receber, aquele que fica salvo no final").
 *
 * Self-bill paga: a linha do job (`partner_cost` + `materials_cost`) e cada
 * visita extra feita do parceiro (`visitCountsForPartnerPayout`). Puro na conta;
 * só lê as visitas.
 */
export async function valorFinalDoParceiroNoJob(
  supabase: SupabaseClient,
  job: { id: string; partner_id?: string | null; partner_cost?: number | null; materials_cost?: number | null },
  partnerId: string,
): Promise<ValorFinalDoParceiro> {
  const doJob = (job.partner_id ?? "").trim() === partnerId.trim();
  let labour = doJob ? Number(job.partner_cost ?? 0) || 0 : 0;
  let materials = doJob ? Number(job.materials_cost ?? 0) || 0 : 0;
  let extraVisits = 0;

  const { data, error } = await supabase
    .from("job_visits")
    .select("id, visit_index, partner_id, partner_cost, materials_cost, status, deleted_at, report_submitted_at")
    .eq("job_id", job.id)
    .eq("partner_id", partnerId)
    .gt("visit_index", 1)
    .is("deleted_at", null);
  if (!error) {
    for (const v of (data ?? []) as Array<Pick<JobVisit, "partner_cost" | "materials_cost" | "status" | "deleted_at"> & { report_submitted_at?: string | null }>) {
      if (!visitCountsForPartnerPayout(v as never)) continue;
      labour += Number(v.partner_cost ?? 0) || 0;
      materials += Number(v.materials_cost ?? 0) || 0;
      extraVisits++;
    }
  }
  labour = r2(labour);
  materials = r2(materials);
  return { labour, materials, extraVisits, total: r2(labour + materials) };
}
