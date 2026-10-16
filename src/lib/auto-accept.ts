/**
 * Auto-accept (decisão do dono, 29/09/2026): o parceiro liga no portal, aceita
 * as regras, e job que bate com ele vira dele na hora, sem oferta.
 *
 * Entra no começo do despacho: dos parceiros que iam receber a oferta, se
 * algum tem o auto-accept ligado (com o aceite dos termos gravado), o que tem
 * menos jobs no dia leva o job pelo mesmo caminho de um aceite do portal
 * (claim atômico, os outros convites viram "lost", e-mail de booked). Sem
 * ninguém com a chave, a oferta segue para todos, como sempre.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { carregarJobs, dataEmLondres } from "@/lib/capacity";
import { escolherAutoAceite, type ParceiroParaEscala } from "@/lib/elegibilidade-parceiro";

export async function tentarAutoAceite(
  supabase: SupabaseClient,
  jobId: string,
  partnerIds: string[],
): Promise<{ partnerId: string } | null> {
  if (process.env.AUTO_ACCEPT_LIGADO === "0" || !partnerIds.length) return null;
  const { data: parceiros } = await supabase
    .from("partners")
    .select("id, status, catalog_service_ids, availability, job_preferences")
    .in("id", partnerIds)
    .eq("status", "active");
  const comChave = ((parceiros ?? []) as ParceiroParaEscala[]).filter((p) => p.job_preferences?.autoAccept?.on === true);
  if (!comChave.length) return null;

  const { data: job } = await supabase.from("jobs").select("scheduled_date, scheduled_start_at, status, partner_id").eq("id", jobId).maybeSingle();
  if (!job || job.status !== "auto_assigning" || job.partner_id) return null;
  const data = (job.scheduled_date as string | null)?.slice(0, 10) || (job.scheduled_start_at ? dataEmLondres(job.scheduled_start_at as string) : null);
  const jobs = data ? await carregarJobs(supabase, data, data) : [];
  const escolhido = escolherAutoAceite(comChave, jobs, data);
  if (!escolhido) return null;

  const { processAutoAssignJobAccept } = await import("@/lib/job-partner-acceptance");
  const r = await processAutoAssignJobAccept({ supabase, jobId, partnerId: escolhido.id });
  if (!r.ok) {
    console.warn("[auto-accept] não levou", jobId, escolhido.id, r);
    return null;
  }
  console.log("[auto-accept]", jobId, "→", escolhido.id);
  return { partnerId: escolhido.id };
}
