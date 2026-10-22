/**
 * Por que este job está em Action Required (plano do dono, 22/10/2026, item 2).
 *
 * Função pura: recebe o job (e o processo da conta) e devolve os motivos abertos.
 * Não mexe em jobs.status nem no financeiro. A tabela job_attention_reasons
 * (migration 344) guarda o resultado; `sincronizarPendencias` abre o que
 * apareceu e resolve o que sumiu.
 *
 * Regras:
 *   date_tbc               sem data confirmada antes da execução, com ou sem parceiro
 *   partner_required       sem parceiro (Unassigned, Auto-assigning ou agendado sem parceiro)
 *   deposit_pending        fluxo com sinal e o sinal ainda não entrou
 *   card_declined          cartão recusado ou pedindo confirmação do banco
 *   payment_unsuccessful   cartão recusado há 7 dias ou mais sem resolver
 *   report_incomplete      em Final Check sem report do parceiro (report_1_uploaded é a marca
 *                          que o portal grava; final_report_submitted quase nunca vem)
 *   human_review_required  job em Need attention
 *   price_missing          sem preço ao cliente
 *   partner_cost_missing   com parceiro e sem custo do parceiro
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RegrasDoProcesso } from "@/lib/processo/conta";

export const MOTIVOS = [
  "date_tbc",
  "partner_required",
  "deposit_pending",
  "card_declined",
  "payment_unsuccessful",
  "report_incomplete",
  "human_review_required",
  "price_missing",
  "partner_cost_missing",
  "job_creation_failed",
] as const;
export type Motivo = (typeof MOTIVOS)[number];

export const ROTULO_DO_MOTIVO: Record<Motivo, string> = {
  date_tbc: "Date TBC",
  partner_required: "Partner Required",
  deposit_pending: "Deposit Pending",
  card_declined: "Card Declined",
  payment_unsuccessful: "Payment Unsuccessful",
  report_incomplete: "Report Incomplete",
  human_review_required: "Human Review Required",
  price_missing: "Price Missing",
  partner_cost_missing: "Partner Cost Missing",
  job_creation_failed: "Job Creation Failed",
};

export const DIAS_ATE_PAGAMENTO_SEM_SUCESSO = 7;

export type JobParaPendencias = {
  status: string;
  scheduled_date?: string | null;
  scheduled_start_at?: string | null;
  partner_id?: string | null;
  client_price?: number | string | null;
  partner_cost?: number | string | null;
  customer_deposit?: number | string | null;
  customer_deposit_paid?: boolean | null;
  finance_status?: string | null;
  payment_status?: string | null;
  card_charge_status?: string | null;
  final_report_submitted?: boolean | null;
  final_report_skipped?: boolean | null;
  report_1_uploaded?: boolean | null;
  report_submitted?: boolean | null;
};

const ENCERRADOS = new Set(["completed", "cancelled", "deleted"]);
const SEM_PARCEIRO = new Set(["unassigned", "auto_assigning"]);
const AGENDADOS = new Set(["scheduled", "late", "in_progress"]);
/** Antes da execução: depois do trabalho feito, data a confirmar não é mais pendência. */
const ANTES_DA_EXECUCAO = new Set(["unassigned", "auto_assigning", "scheduled", "late", "on_hold"]);

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function motivosDoJob(
  job: JobParaPendencias,
  processo: Pick<RegrasDoProcesso, "agendarSoComSinal" | "cobraDoCliente"> | null,
  contexto: { diasDesdeARecusa?: number | null } = {},
): Motivo[] {
  const motivos: Motivo[] = [];
  if (ENCERRADOS.has(job.status)) return motivos;
  const pago = (job.finance_status ?? job.payment_status) === "paid";

  if (ANTES_DA_EXECUCAO.has(job.status) && !job.scheduled_date && !job.scheduled_start_at) motivos.push("date_tbc");
  if (SEM_PARCEIRO.has(job.status) || (AGENDADOS.has(job.status) && !job.partner_id)) motivos.push("partner_required");
  if (processo?.agendarSoComSinal && processo.cobraDoCliente && num(job.customer_deposit) > 0 && !job.customer_deposit_paid && !pago) motivos.push("deposit_pending");

  const recusado = job.card_charge_status === "refused" || job.card_charge_status === "requires_action";
  if (recusado && !pago) {
    const dias = contexto.diasDesdeARecusa;
    motivos.push(dias != null && dias >= DIAS_ATE_PAGAMENTO_SEM_SUCESSO ? "payment_unsuccessful" : "card_declined");
  }
  const temReport = job.report_1_uploaded || job.report_submitted || job.final_report_submitted || job.final_report_skipped;
  if (job.status === "final_check" && !temReport) motivos.push("report_incomplete");
  if (job.status === "need_attention") motivos.push("human_review_required");
  if (!(num(job.client_price) > 0)) motivos.push("price_missing");
  if (job.partner_id && !(num(job.partner_cost) > 0)) motivos.push("partner_cost_missing");
  return motivos;
}

/**
 * Grava a diferença: abre o motivo novo, resolve o que sumiu. Nunca mexe em
 * motivo aberto à mão (opened_by diferente de system) nem em job_creation_failed,
 * que só quem cria o job sabe resolver.
 */
export async function sincronizarPendencias(
  sb: SupabaseClient,
  jobId: string,
  agora: Motivo[],
  opcoes: { aplicar: boolean },
): Promise<{ abrir: Motivo[]; resolver: Motivo[] }> {
  const { data } = await sb.from("job_attention_reasons").select("reason, opened_by").eq("job_id", jobId).is("resolved_at", null);
  const abertos = new Set((data ?? []).map((r: { reason: string }) => r.reason as Motivo));
  const doSistema = new Set((data ?? []).filter((r: { opened_by: string }) => r.opened_by === "system").map((r: { reason: string }) => r.reason as Motivo));
  const abrir = agora.filter((m) => !abertos.has(m));
  const resolver = [...doSistema].filter((m) => m !== "job_creation_failed" && !agora.includes(m));
  if (!opcoes.aplicar) return { abrir, resolver };
  if (abrir.length) {
    // O índice parcial (um aberto por job e motivo) segura duas rodadas ao mesmo tempo.
    await sb.from("job_attention_reasons").upsert(abrir.map((reason) => ({ job_id: jobId, reason })), { onConflict: "job_id,reason", ignoreDuplicates: true });
  }
  if (resolver.length) {
    await sb.from("job_attention_reasons").update({ resolved_at: new Date().toISOString(), resolved_by: "system" }).eq("job_id", jobId).is("resolved_at", null).in("reason", resolver);
  }
  return { abrir, resolver };
}
