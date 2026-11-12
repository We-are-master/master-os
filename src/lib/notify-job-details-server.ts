/**
 * Avisa que o endereço ou o cliente do job mudou, com o antigo riscado ao lado
 * do novo. Mesma entrega do aviso de preço (ticket do job, Resend de reserva).
 *
 *  - Endereço: cliente (conta ou morador) e parceiro.
 *  - Cliente trocado: só o parceiro (quem vai ao local precisa saber quem atende).
 *
 * Nada lança: cada lado volta ok / skipped / error.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { formatJobScheduleLine } from "@/lib/schedule-calendar";
import {
  COLUNAS_DO_JOB_DO_AVISO,
  entregarAoCliente,
  entregarAoParceiro,
  type JobDoAviso,
  type ResultadoAvisoDePreco,
} from "@/lib/notify-price-change-server";
import {
  buildClientJobDetailsChangedEmail,
  buildPartnerJobDetailsChangedEmail,
  mudancasReais,
  type MudancaDeCampo,
} from "@/lib/emails/job-details-changed";

export type ResultadoAvisoDeDados = { client: ResultadoAvisoDePreco; partner: ResultadoAvisoDePreco };

export async function avisarMudancaDeDados(
  jobId: string,
  mudancas: MudancaDeCampo[],
  client?: SupabaseClient,
): Promise<ResultadoAvisoDeDados> {
  const reais = mudancasReais(mudancas);
  if (!reais.length) {
    const skipped = "nothing changed";
    return { client: { ok: false, skipped }, partner: { ok: false, skipped } };
  }
  let supabase: SupabaseClient;
  try {
    supabase = client ?? createServiceClient();
  } catch (err) {
    const error = err instanceof Error ? err.message : "supabase unavailable";
    return { client: { ok: false, error }, partner: { ok: false, error } };
  }
  const { data } = await supabase
    .from("jobs")
    .select(`${COLUNAS_DO_JOB_DO_AVISO}, scheduled_date, scheduled_start_at, scheduled_end_at, scheduled_finish_date`)
    .eq("id", jobId)
    .maybeSingle();
  const job = data as (JobDoAviso & Parameters<typeof formatJobScheduleLine>[0]) | null;
  if (!job) return { client: { ok: false, error: "job_not_found" }, partner: { ok: false, error: "job_not_found" } };

  const agenda = formatJobScheduleLine(job) || null;
  const ref = String(job.reference ?? "");
  const titulo = String(job.title ?? "") || "Maintenance job";
  const temEndereco = reais.some((m) => m.campo === "address");

  const [c, p] = await Promise.all([
    temEndereco
      ? entregarAoCliente(
          supabase,
          job,
          (publico) => buildClientJobDetailsChangedEmail({ publico, jobReference: ref, jobTitle: titulo, mudancas: reais, agenda }),
          "notify-job-details",
        ).catch((err): ResultadoAvisoDePreco => ({ ok: false, error: err instanceof Error ? err.message : "client notice failed" }))
      : Promise.resolve<ResultadoAvisoDePreco>({ ok: false, skipped: "only the customer changed" }),
    entregarAoParceiro(
      supabase,
      job,
      ({ primeiroNome, jobUrl }) =>
        buildPartnerJobDetailsChangedEmail({ partnerFirstName: primeiroNome, jobReference: ref, jobTitle: titulo, mudancas: reais, agenda, jobUrl }),
      "notify-job-details",
    ).catch((err): ResultadoAvisoDePreco => ({ ok: false, error: err instanceof Error ? err.message : "partner notice failed" })),
  ]);
  return { client: c, partner: p };
}
