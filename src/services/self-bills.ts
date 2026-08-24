import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./base";
import type { Job, SelfBill, SelfBillStatus } from "@/types/database";
import {
  officeCancellationPartnerClawbackGbp,
  officeCancellationPartnerPayoutGbp,
  partnerCancellationClawbackOwedGbp,
} from "@/lib/job-cancel-economics";
import { parseISO } from "date-fns";
import {
  computePartnerSelfBillDueIso,
  nextPartnerPayoutCycleAfterCurrent,
  partnerPayoutCadenceFromTerms,
  resolveSelfBillDueYmd,
  workPeriodForJobStartYmd,
  type SelfBillDueResolveContext,
} from "@/lib/partner-payout-schedule";
import { getWeekBoundsForDate } from "@/lib/self-bill-period";
import { parseFrontendSetup } from "@/lib/frontend-setup";
import {
  normalizePartnerPayoutReferenceYmd,
  resolveOrgPartnerPayoutStandardTerms,
} from "@/lib/partner-payout-schedule";
import {
  isPostgresCheckViolationError,
  isSupabaseMissingColumnError,
  parsePostgrestUnknownColumnName,
} from "@/lib/supabase-schema-compat";

const JOB_LINE_FOR_SB_FULL =
  "id, reference, title, partner_cost, partner_agreed_value, materials_cost, status, property_address, scheduled_date, scheduled_start_at, scheduled_end_at, scheduled_finish_date, deleted_at, partner_cancelled_at, partner_cancellation_fee, cancellation_fee_partner_gbp, partner_cancellation_compensation_gbp";
const JOB_LINE_FOR_SB_FULL_WITH_LINK =
  "id, reference, title, partner_cost, partner_agreed_value, materials_cost, status, property_address, scheduled_date, scheduled_start_at, scheduled_end_at, scheduled_finish_date, self_bill_id, deleted_at, partner_cancelled_at, partner_cancellation_fee, cancellation_fee_partner_gbp, partner_cancellation_compensation_gbp";
const JOB_LINE_FOR_SB_LEGACY =
  "id, reference, title, partner_cost, partner_agreed_value, materials_cost, status, property_address, scheduled_date, scheduled_start_at, scheduled_end_at, scheduled_finish_date, deleted_at";
const JOB_LINE_FOR_SB_LEGACY_WITH_LINK =
  "id, reference, title, partner_cost, partner_agreed_value, materials_cost, status, property_address, scheduled_date, scheduled_start_at, scheduled_end_at, scheduled_finish_date, self_bill_id, deleted_at";

export type SelfBillJobLine = Pick<
  Job,
  | "id"
  | "reference"
  | "title"
  | "partner_cost"
  | "partner_agreed_value"
  | "materials_cost"
  | "status"
  | "property_address"
  | "scheduled_date"
  | "scheduled_start_at"
  | "scheduled_end_at"
  | "scheduled_finish_date"
  | "partner_cancellation_fee"
  | "cancellation_fee_partner_gbp"
  | "partner_cancellation_compensation_gbp"
> & {
  deleted_at?: string | null;
  partner_cancelled_at?: string | null;
};

export type SelfBillLinkedJobRow = SelfBillJobLine & { self_bill_id: string };

async function fetchJobLinesForSelfBill(
  supabase: SupabaseClient,
  options: { selfBillId: string } | { selfBillIds: string[] },
  includeSelfBillIdColumn: boolean,
): Promise<SelfBillJobLine[] | SelfBillLinkedJobRow[]> {
  const full = includeSelfBillIdColumn ? JOB_LINE_FOR_SB_FULL_WITH_LINK : JOB_LINE_FOR_SB_FULL;
  const legacy = includeSelfBillIdColumn ? JOB_LINE_FOR_SB_LEGACY_WITH_LINK : JOB_LINE_FOR_SB_LEGACY;

  const build = (cols: string) => {
    let q = supabase.from("jobs").select(cols).order("reference", { ascending: true });
    if ("selfBillId" in options) {
      q = q.eq("self_bill_id", options.selfBillId);
    } else {
      if (options.selfBillIds.length === 0) return null;
      q = q.in("self_bill_id", options.selfBillIds);
    }
    return q;
  };

  const first = build(full);
  if (!first) return [];

  let { data, error } = await first;
  /** Any missing column in the “full” select — retry without `partner_cancelled_at` (older DBs). */
  if (error && isSupabaseMissingColumnError(error)) {
    const second = build(legacy);
    if (second) ({ data, error } = await second);
  }
  if (error) throw error;
  return (data ?? []) as unknown as SelfBillJobLine[] | SelfBillLinkedJobRow[];
}

export type CreateSelfBillFromJobInput = Pick<
  Job,
  "id" | "reference" | "partner_name" | "partner_cost" | "materials_cost"
>;

/** Self-bills with zero payout due to archived / cancelled / lost jobs (kept visible for audit). */
export const SELF_BILL_PAYOUT_VOID_STATUSES: SelfBillStatus[] = [
  "payout_archived",
  "payout_cancelled",
  "payout_lost",
];

/**
 * Terminal statuses: a new job must never be linked to a self-bill in one of these states.
 * Instead, a fresh self-bill is created so the new job has no history with the old one.
 */
export const SELF_BILL_TERMINAL_STATUSES: SelfBillStatus[] = [
  ...SELF_BILL_PAYOUT_VOID_STATUSES,
  "rejected",
];

export function isSelfBillPayoutVoided(sb: Pick<SelfBill, "status">): boolean {
  return SELF_BILL_PAYOUT_VOID_STATUSES.includes(sb.status);
}

/** Paid, office-cancelled, or partner void — hide from active ledgers. */
export function isSelfBillClosed(sb: Pick<SelfBill, "status">): boolean {
  return sb.status === "paid" || sb.status === "rejected" || isSelfBillPayoutVoided(sb);
}

/**
 * A referência do self-bill, pela sequência do banco.
 *
 * Era `SB-${weekLabel}-${jobRef}`, o que produzia `SB-2026-W32-JOB-9380`: uma
 * semana ISO num documento que cobre quinzena, mais o número de UM job entre
 * treze, escolhido por acaso (o primeiro vinculado). E podia colidir.
 *
 * `next_self_bill_ref` (mig 271) devolve uma sequência simples e curta:
 * `SB-14445`, `SB-14446`. Começa alta de propósito, para a referência não
 * contar ao parceiro quantos documentos a empresa já emitiu.
 *
 * Cai de volta no formato antigo se a função ainda não existir no ambiente, em
 * vez de deixar o self-bill sem nascer.
 */
async function nextSelfBillRef(
  supabase: SupabaseClient,
  weekLabel: string,
  jobRef: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("next_self_bill_ref");
  if (!error && typeof data === "string" && data.trim()) return data.trim();
  const short = jobRef.replace(/\s/g, "").slice(0, 8);
  return `SB-${weekLabel}-${short}`;
}

type JobPayoutRow = {
  partner_cost?: number | null;
  materials_cost?: number | null;
  status?: string | null;
  deleted_at?: string | null;
  partner_cancelled_at?: string | null;
  partner_cancellation_fee?: number | null;
  cancellation_fee_partner_gbp?: number | null;
  partner_cancellation_compensation_gbp?: number | null;
};

/** Job statuses that count toward partner labour/materials on a weekly self-bill. */
export const SELF_BILL_PAYOUT_APPROVED_JOB_STATUSES = new Set<string>([
  "awaiting_payment",
  "completed",
]);

export function isJobApprovedForSelfBillPayout(
  j: Pick<Job, "status" | "deleted_at">,
): boolean {
  if (j.deleted_at) return false;
  if (j.status === "deleted" || j.status === "cancelled") return false;
  return SELF_BILL_PAYOUT_APPROVED_JOB_STATUSES.has(j.status);
}

/** Active jobs that still count toward partner payout on a weekly self-bill. */
export function jobContributesToSelfBillPayout(
  j: Pick<
    Job,
    | "status"
    | "deleted_at"
    | "partner_cancelled_at"
    | "partner_cancellation_compensation_gbp"
    | "cancellation_fee_partner_gbp"
    | "partner_cancellation_fee"
  >,
): boolean {
  if (j.deleted_at) return false;
  if (j.status === "deleted") return false;
  if (j.status === "cancelled") {
    return officeCancellationPartnerPayoutGbp(j) > 0.02;
  }
  return isJobApprovedForSelfBillPayout(j);
}

/** Partner-readable job state when the job no longer counts toward payout (for UI / PDF). */
export function selfBillJobPayoutStateLabel(
  j: Pick<Job, "status" | "deleted_at" | "partner_cancelled_at">,
): string | null {
  if (j.deleted_at) return j.status === "deleted" ? "Deleted" : "Archived";
  if (j.status === "cancelled" && j.partner_cancelled_at) return "Lost";
  if (j.status === "cancelled") return "Cancelled";
  if (j.status === "on_hold") return "On hold";
  if (j.status === "in_progress") return "In progress";
  if (j.status === "final_check") return "Final checks";
  if (!isJobApprovedForSelfBillPayout(j)) return "Not approved";
  return null;
}

/**
 * Documentos que ainda aceitam trabalho novo.
 *
 * Fora daqui — `awaiting_payment`, `ready_to_pay`, `paid`, cancelados — o
 * documento já saiu da mesa: pendurar uma visita nele é somar dinheiro a um
 * papel que já está em pagamento. Aconteceu no teste de 23/08/2026: uma visita
 * de £70 entrou num self-bill de £248 em awaiting_payment de OUTRO job.
 */
export const SELF_BILL_REUSABLE_STATUSES = new Set(["draft", "accumulating"]);

/** O índice único da mig 277 recusando um segundo balde aberto. */
export function isDuplicateOpenBucketError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const msg = String((error as { message?: string } | null)?.message ?? "");
  return code === "23505" || msg.includes("uq_self_bills_partner_period_open");
}

/**
 * Update que pode devolver o documento a um estado ABERTO.
 *
 * Existe por causa do índice da mig 277. Quando um documento é promovido e o
 * trabalho volta atrás (job que retorna a `in_progress`, visita reaberta,
 * compensação de cancelamento), o refresh reabre o documento para
 * `accumulating`. Se nesse meio-tempo já nasceu outro balde para o mesmo
 * parceiro e período, essa escrita colide.
 *
 * Reabrir à força não é opção: seriam dois baldes abertos, que é justamente o
 * que o índice proíbe. Então o documento cai em `needs_attention` — não é o
 * balde, mas também não fica parado em `ready_to_pay` com valor cheio esperando
 * pagamento. É o estado que aparece no Money Out para alguém olhar.
 *
 * O silêncio é o risco real aqui: quase todo chamador deste caminho faz
 * `.catch(console.error)`.
 */
async function updateSelfBillPossiblyReopening(
  supabase: SupabaseClient,
  selfBillId: string,
  patch: Record<string, unknown>,
): Promise<{ error: unknown | null }> {
  const { error } = await supabase.from("self_bills").update(patch).eq("id", selfBillId);
  if (!error || !isDuplicateOpenBucketError(error)) return { error };

  const rebaixado = { ...patch, status: "needs_attention" };
  const retry = await supabase.from("self_bills").update(rebaixado).eq("id", selfBillId);
  if (!retry.error) {
    console.error(
      `self-bill ${selfBillId}: já existe um documento aberto para este parceiro e período; ` +
        `este ficou em needs_attention em vez de reabrir.`,
    );
    return { error: null };
  }
  return { error: retry.error };
}

export type SelfBillPayoutLine = {
  kind: "job" | "visit";
  /** `job_id` na linha de job; `job_visits.id` na linha de visita. */
  id: string;
  jobId: string;
  visitIndex: number | null;
  labour: number;
  materials: number;
};

/**
 * Linhas pagáveis de um self-bill, de UMA fonte só.
 *
 * Totais e PDF chamam esta função. Não pode haver duas consultas: o rodapé do
 * PDF já divergiu das linhas uma vez (£1.055 nas linhas contra £430 no total),
 * e agora que existem duas origens de linha o risco dobra.
 *
 * A visita entra pelo VALOR assim que existe e está viva, igual ao job, que
 * aparece no rascunho antes de ser pagável. Documento zerado com visita de £70
 * marcada esconde o que o parceiro tem a receber.
 *
 * O que espera o "done" é a LIBERAÇÃO, não o valor: `refreshSelfBillPayoutState`
 * só promove a ready_to_pay quando não há visita em aberto, e a rota de aprovar
 * recusa documento com visita pendente.
 */
/**
 * Linhas de VISITA de um ou mais self-bills, com as regras de pagamento
 * aplicadas. Fonte única: o PDF, o recompute e a coluna Outstanding leem daqui,
 * porque o dia em que uma delas consultar por conta própria elas divergem — já
 * aconteceu (linhas de £1.055 contra rodapé de £430).
 */
async function loadVisitPayoutLinesForSelfBills(
  supabase: SupabaseClient,
  selfBillIds: string[],
): Promise<(SelfBillPayoutLine & { selfBillId: string })[]> {
  if (selfBillIds.length === 0) return [];

  const { data: visitRows, error: visitErr } = await supabase
    .from("job_visits")
    .select("id, job_id, self_bill_id, visit_index, partner_cost, materials_cost, status, deleted_at")
    .in("self_bill_id", selfBillIds)
    .is("deleted_at", null);
  // Ambiente sem a mig 161/276 não tem tabela nem coluna: o self-bill segue
  // valendo com as linhas de job.
  if (visitErr) {
    if (isSupabaseMissingColumnError(visitErr) || (visitErr as { code?: string }).code === "42P01") return [];
    throw visitErr;
  }

  const vivas = ((visitRows ?? []) as {
    id: string; job_id: string; self_bill_id: string; visit_index: number;
    partner_cost: number | null; materials_cost: number | null; status: string;
  }[]).filter((row) => row.status !== "cancelled");
  if (vivas.length === 0) return [];

  /**
   * Visita de job morto não vale dinheiro.
   *
   * Não existe cascata: apagar ou cancelar o job não mexe em `job_visits`. Sem
   * este filtro, o parceiro da visita 2 continuava a ser pago por um job
   * deletado — a linha some da tela e permanece no documento que ele assina. A
   * linha de job já tinha essa proteção em `isJobApprovedForSelfBillPayout`; a
   * de visita não tinha nenhuma.
   */
  const jobIds = [...new Set(vivas.map((v) => v.job_id))];
  const { data: donos, error: donoErr } = await supabase
    .from("jobs")
    .select("id, status, deleted_at")
    .in("id", jobIds);
  if (donoErr) throw donoErr;
  const vivosPorId = new Map(
    ((donos ?? []) as { id: string; status: string; deleted_at: string | null }[]).map((j) => [j.id, j]),
  );
  const jobVivo = (id: string): boolean => {
    const j = vivosPorId.get(id);
    // Job que sumiu da tabela conta como morto.
    if (!j) return false;
    return !j.deleted_at && j.status !== "cancelled" && j.status !== "deleted";
  };

  return vivas
    .filter((row) => jobVivo(row.job_id))
    .map((row) => ({
      kind: "visit" as const,
      id: row.id,
      jobId: row.job_id,
      selfBillId: row.self_bill_id,
      visitIndex: row.visit_index,
      labour: Number(row.partner_cost) || 0,
      materials: Number(row.materials_cost) || 0,
    }));
}

export async function loadSelfBillPayoutLines(
  selfBillId: string,
  client?: SupabaseClient,
): Promise<SelfBillPayoutLine[]> {
  const supabase = client ?? getSupabase();
  const lines: SelfBillPayoutLine[] = [];

  const { data: jobRows, error: jobErr } = await supabase
    .from("jobs")
    .select("id, partner_cost, materials_cost, status, deleted_at")
    .eq("self_bill_id", selfBillId);
  if (jobErr) throw jobErr;
  for (const row of (jobRows ?? []) as (JobPayoutRow & { id: string })[]) {
    if (!isJobApprovedForSelfBillPayout(row as Job)) continue;
    lines.push({
      kind: "job",
      id: row.id,
      jobId: row.id,
      visitIndex: null,
      labour: Number(row.partner_cost) || 0,
      materials: Number(row.materials_cost) || 0,
    });
  }

  for (const v of await loadVisitPayoutLinesForSelfBills(supabase, [selfBillId])) {
    const { selfBillId: _sb, ...linha } = v;
    lines.push(linha);
  }

  return lines;
}

/**
 * As linhas de visita de vários documentos de uma vez, agrupadas por self-bill.
 * É o que a tela do Financeiro usa para somar o Outstanding sem uma consulta
 * por documento.
 */
export async function listVisitPayoutLinesBySelfBillId(
  selfBillIds: string[],
  client?: SupabaseClient,
): Promise<Record<string, SelfBillPayoutLine[]>> {
  const ids = [...new Set(selfBillIds.filter((x) => Boolean(x && String(x).trim())))];
  if (ids.length === 0) return {};
  const supabase = client ?? getSupabase();
  /**
   * Toda chave consultada volta, mesmo vazia.
   *
   * A tela funde o resultado com spread. Sem a chave presente, um documento que
   * PERDEU as visitas (cancelada, excluída, job deletado) mantinha o valor
   * antigo em cima da tela até alguém recarregar a página.
   */
  const out: Record<string, SelfBillPayoutLine[]> = {};
  for (const id of ids) out[id] = [];
  for (let i = 0; i < ids.length; i += SELF_BILL_JOB_QUERY_CHUNK) {
    const chunk = ids.slice(i, i + SELF_BILL_JOB_QUERY_CHUNK);
    for (const v of await loadVisitPayoutLinesForSelfBills(supabase, chunk)) {
      const { selfBillId, ...linha } = v;
      (out[selfBillId] ??= []).push(linha);
    }
  }
  return out;
}

/**
 * Todo self-bill que este job toca: o dele e o de cada visita.
 *
 * `jobs.self_bill_id` é escalar e só conhece o documento do parceiro da visita
 * 1. Job com visitas de outros parceiros tem dinheiro em VÁRIOS documentos, e
 * quem só lê a coluna do job deixa os outros para trás — deletar o job pela
 * tela mantinha o parceiro da visita 2 sendo pago.
 */
export async function selfBillIdsTouchedByJob(
  jobIds: string[],
  client?: SupabaseClient,
): Promise<string[]> {
  const ids = jobIds.filter((x) => Boolean(x && String(x).trim()));
  if (ids.length === 0) return [];
  const supabase = client ?? getSupabase();
  const encontrados = new Set<string>();

  const { data: jobRows, error: jobErr } = await supabase
    .from("jobs")
    .select("self_bill_id")
    .in("id", ids);
  if (jobErr) throw jobErr;
  for (const r of (jobRows ?? []) as { self_bill_id: string | null }[]) {
    if (r.self_bill_id?.trim()) encontrados.add(r.self_bill_id.trim());
  }

  // Banco sem a mig 276 não tem a coluna: o job segue valendo pelo documento dele.
  const { data: visitRows, error: visitErr } = await supabase
    .from("job_visits")
    .select("self_bill_id")
    .in("job_id", ids);
  if (visitErr) {
    if (!isSupabaseMissingColumnError(visitErr) && (visitErr as { code?: string }).code !== "42P01") {
      throw visitErr;
    }
  } else {
    for (const r of (visitRows ?? []) as { self_bill_id: string | null }[]) {
      if (r.self_bill_id?.trim()) encontrados.add(r.self_bill_id.trim());
    }
  }

  return [...encontrados];
}

/**
 * Recompute labour/materials/net from linked jobs that are still payable (not archived, not cancelled).
 * Does not assign payout-void status — use `refreshSelfBillPayoutState` after job lifecycle changes.
 */
export async function recomputeSelfBillTotals(selfBillId: string): Promise<void> {
  const supabase = getSupabase();
  const lines = await loadSelfBillPayoutLines(selfBillId, supabase);
  /** Jobs distintos, não linhas: um parceiro em duas visitas do mesmo job é 1 job. */
  const jobsCount = new Set(lines.map((l) => l.jobId)).size;
  let jobValue = 0;
  let materials = 0;
  for (const l of lines) {
    jobValue += l.labour;
    materials += l.materials;
  }
  const commission = 0;
  const netPayout = jobValue + materials - commission;
  /**
   * `approved_at` sai do JOB, não de um clique separado.
   *
   * O dono decidiu em 20/08/2026: relatório final aprovado já libera o valor, e
   * ninguém aprova o self-bill de novo. `isJobApprovedForSelfBillPayout` acima
   * já é esse filtro, então quando `jobsCount` passa de zero existe trabalho
   * aprovado dentro deste documento e a data pode ser carimbada.
   *
   * Antes disto o campo existia e estava vazio nos 20 self-bills abertos,
   * inclusive nos que já estavam `ready_to_pay`: um conceito que ninguém
   * preenchia e por isso não significava nada.
   *
   * Só carimba uma vez: o primeiro job aprovado é o que datou o documento.
   */
  const patch: Record<string, unknown> = {
    jobs_count: jobsCount,
    job_value: jobValue,
    materials,
    commission,
    net_payout: netPayout,
  };
  if (jobsCount > 0) {
    const { data: atual } = await supabase
      .from("self_bills")
      .select("approved_at")
      .eq("id", selfBillId)
      .maybeSingle();
    if (!(atual as { approved_at?: string | null } | null)?.approved_at) {
      patch.approved_at = new Date().toISOString();
    }
  }

  const { error: uErr } = await supabase.from("self_bills").update(patch).eq("id", selfBillId);
  if (uErr) throw uErr;
}

/**
 * Recompute totals from payable jobs, then set payout-void status (or reopen accumulating) from linked job states.
 * Skips **paid** and **internal** self-bills. Call after job status/archive changes and weekly linking.
 */
export async function refreshSelfBillPayoutState(
  selfBillId: string,
  client?: SupabaseClient,
): Promise<void> {
  const supabase = client ?? getSupabase();
  const before = client
    ? ((await supabase.from("self_bills").select("*").eq("id", selfBillId).maybeSingle()).data as SelfBill | null)
    : await getSelfBill(selfBillId);
  if (!before) return;
  if (before.bill_origin === "internal") return;
  if (before.status === "paid") return;
  /** Manual office cancel / reject must not be reopened by linked jobs until user explicitly reopens. */
  if (SELF_BILL_TERMINAL_STATUSES.includes(before.status)) return;

  const prevNet = Number(before.net_payout) || 0;
  const prevOriginalSnapshot = before.original_net_payout;

  /** One jobs query — prefer partner clawback / office cancel fee columns when present */
  const jobColsWithOfficeFees =
    "partner_cost, materials_cost, status, deleted_at, partner_cancelled_at, partner_cancellation_fee, cancellation_fee_partner_gbp, partner_cancellation_compensation_gbp";
  const jobColsWithPartnerClaw =
    "partner_cost, materials_cost, status, deleted_at, partner_cancelled_at, partner_cancellation_fee";
  const jobColsLegacy = "partner_cost, materials_cost, status, deleted_at";

  let jobs: JobPayoutRow[];
  const tryOffice = await supabase.from("jobs").select(jobColsWithOfficeFees).eq("self_bill_id", selfBillId);
  if (!tryOffice.error) {
    jobs = (tryOffice.data ?? []) as JobPayoutRow[];
  } else {
    const try1 = await supabase.from("jobs").select(jobColsWithPartnerClaw).eq("self_bill_id", selfBillId);
    if (!try1.error) {
      jobs = (try1.data ?? []) as JobPayoutRow[];
    } else {
      const tryLegacy = await supabase.from("jobs").select(jobColsLegacy).eq("self_bill_id", selfBillId);
      if (tryLegacy.error) throw tryOffice.error;
      jobs = (tryLegacy.data ?? []) as JobPayoutRow[];
    }
  }

  const payable = jobs.filter((r) => isJobApprovedForSelfBillPayout(r as Job));
  let jobValue = 0;
  let materials = 0;
  for (const r of payable) {
    jobValue += Number(r.partner_cost) || 0;
    materials += Number(r.materials_cost) || 0;
  }
  /**
   * Visitas ligadas a este documento (mig 161). O clawback e as taxas de
   * cancelamento abaixo continuam por job: visita não tem cancelamento próprio
   * nesta fase.
   */
  const visitLines = (await loadSelfBillPayoutLines(selfBillId, supabase)).filter((l) => l.kind === "visit");
  for (const l of visitLines) {
    jobValue += l.labour;
    materials += l.materials;
  }
  /**
   * Continua contando JOBS no documento, não linhas: é o número que o parceiro
   * já lê na lista de self-bills. O PDF pode legitimamente ter mais linhas que
   * isto quando há visitas.
   */
  const jobsCount = payable.length;
  const commission = 0;
  let clawAdjustAll = 0;
  let officePayoutAdjustAll = 0;
  for (const r of jobs) {
    clawAdjustAll += partnerCancellationClawbackOwedGbp(r as Job);
    clawAdjustAll += officeCancellationPartnerClawbackGbp(r as Job);
    officePayoutAdjustAll += officeCancellationPartnerPayoutGbp(r as Job);
  }
  const grossLabour = jobValue + materials - commission;
  const netPayout =
    Math.round(Math.max(0, grossLabour - clawAdjustAll + officePayoutAdjustAll) * 100) / 100;

  const { error: uErr } = await supabase
    .from("self_bills")
    .update({
      jobs_count: jobsCount,
      job_value: jobValue,
      materials,
      commission,
      net_payout: netPayout,
    })
    .eq("id", selfBillId);
  if (uErr) throw uErr;

  /**
   * Documento só de visita (nenhum job ligado) é classificado aqui, antes de
   * qualquer ramo que olhe jobs.
   *
   * Estava depois deles e nunca era alcançado: com `netPayout > 0.02` o fluxo
   * entrava no ramo de "cancelado com compensação", reescrevia como
   * `accumulating` e voltava — então documento de visita jamais chegava a
   * ready_to_pay.
   */
  if (jobs.length === 0 && visitLines.length > 0) {
    const { data: openRows } = await supabase
      .from("job_visits")
      .select("id")
      .eq("self_bill_id", selfBillId)
      .is("deleted_at", null)
      .not("status", "in", "(completed,cancelled)")
      .limit(1);
    const temVisitaAberta = (openRows ?? []).length > 0;
    const promovivel = ["draft", "accumulating", "awaiting_payment"].includes(before.status);
    const soVisitaPatch: Record<string, unknown> = {
      jobs_count: jobsCount,
      job_value: jobValue,
      materials,
      commission,
      net_payout: netPayout,
    };
    if (temVisitaAberta) {
      soVisitaPatch.status = before.status === "draft" ? "draft" : "accumulating";
    } else if (promovivel) {
      soVisitaPatch.status = "ready_to_pay";
    }
    const { error: soVisitaErr } = await updateSelfBillPossiblyReopening(supabase, selfBillId, soVisitaPatch);
    if (soVisitaErr) throw soVisitaErr;
    return;
  }

  const paying = payable;

  if (paying.length > 0) {
    if (SELF_BILL_PAYOUT_VOID_STATUSES.includes(before.status)) {
      const net = netPayout;
      if (net > 0.02) {
        const reopenPaidPatch: Record<string, unknown> = {
          status: "accumulating",
          payout_void_reason: null,
          partner_status_label: null,
        };
        let { error: up } = await updateSelfBillPossiblyReopening(supabase, selfBillId, reopenPaidPatch);
        if (up && isSupabaseMissingColumnError(up)) {
          delete reopenPaidPatch.payout_void_reason;
          delete reopenPaidPatch.partner_status_label;
          ({ error: up } = await updateSelfBillPossiblyReopening(supabase, selfBillId, reopenPaidPatch));
        }
        if (up) throw up;
      }
    }
    return;
  }

  /** Cancelled jobs with office partner compensation — fee-only payout, no labour lines. */
  if (netPayout > 0.02) {
    const reopenPatch: Record<string, unknown> = {
      status: "accumulating",
      jobs_count: jobsCount,
      job_value: jobValue,
      materials,
      commission,
      net_payout: netPayout,
      payout_void_reason: null,
      partner_status_label: null,
    };
    const { error: reopenErr } = await updateSelfBillPossiblyReopening(supabase, selfBillId, reopenPatch);
    if (!reopenErr) return;
    if (isSupabaseMissingColumnError(reopenErr)) {
      delete reopenPatch.payout_void_reason;
      delete reopenPatch.partner_status_label;
      const { error: retry } = await updateSelfBillPossiblyReopening(supabase, selfBillId, reopenPatch);
      if (!retry) return;
    }
  }

  if (jobs.length === 0) return;

  /** Jobs still open but not yet payable (on hold, in progress, etc.) — keep the bill, zero payable total. */
  const hasActiveNonPayable = jobs.some(
    (j) =>
      !j.deleted_at &&
      j.status !== "deleted" &&
      j.status !== "cancelled" &&
      !isJobApprovedForSelfBillPayout(j as Job),
  );
  if (hasActiveNonPayable) {
    const holdStatus = before.status === "draft" ? "draft" : "accumulating";
    const holdPatch: Record<string, unknown> = {
      status: holdStatus,
      jobs_count: jobsCount,
      job_value: jobValue,
      materials,
      commission,
      net_payout: netPayout,
      payout_void_reason: null,
      partner_status_label: null,
    };
    let { error: holdErr } = await updateSelfBillPossiblyReopening(supabase, selfBillId, holdPatch);
    if (holdErr && isSupabaseMissingColumnError(holdErr)) {
      delete holdPatch.payout_void_reason;
      delete holdPatch.partner_status_label;
      ({ error: holdErr } = await updateSelfBillPossiblyReopening(supabase, selfBillId, holdPatch));
    }
    if (holdErr) throw holdErr;
    return;
  }

  const hasArchived = jobs.some((j) => Boolean(j.deleted_at));
  const hasLost = jobs.some((j) => j.status === "cancelled" && j.partner_cancelled_at);
  const hasOfficeCancel = jobs.some((j) => j.status === "cancelled" && !j.partner_cancelled_at);

  let nextStatus: SelfBillStatus;
  let partnerLabel: string;
  let reason: string;

  if (hasArchived) {
    nextStatus = "payout_archived";
    partnerLabel = "Archived";
    reason = jobs.length > 1 ? "Jobs archived and removed from payout" : "Job archived and removed from payout";
  } else if (hasLost) {
    nextStatus = "payout_lost";
    partnerLabel = "Lost";
    reason = jobs.length > 1 ? "Jobs marked as lost" : "Job marked as lost";
  } else if (hasOfficeCancel) {
    nextStatus = "payout_cancelled";
    partnerLabel = "Cancelled";
    reason = jobs.length > 1 ? "Jobs cancelled before completion" : "Job cancelled before completion";
  } else {
    nextStatus = "payout_cancelled";
    partnerLabel = "Cancelled";
    reason = "No payable amount on this self-bill";
  }

  const originalNetPayout =
    prevOriginalSnapshot != null && Number.isFinite(Number(prevOriginalSnapshot))
      ? Number(prevOriginalSnapshot)
      : prevNet > 0.02
        ? prevNet
        : null;

  /** Weekly bucket with zero payable labour — net from partner clawbacks on lost rows only (else 0). */
  const voidNetFromCancelAdjust = Math.round(Math.max(0, -clawAdjustAll) * 100) / 100;

  /**
   * Progressively drop columns that the DB's schema cache doesn't know about (migration 100
   * adds `payout_void_reason` / `partner_status_label` / `original_net_payout`; older DBs
   * return PGRST204 for those). Without this retry, the whole status transition was getting
   * swallowed by the caller's try/catch, leaving bills stuck in their pre-cancel status
   * with zeroed totals.
   */
  const voidPatch: Record<string, unknown> = {
    status: nextStatus,
    jobs_count: 0,
    job_value: 0,
    materials: 0,
    commission: 0,
    net_payout: voidNetFromCancelAdjust,
    payout_void_reason: reason,
    partner_status_label: partnerLabel,
    ...(originalNetPayout != null ? { original_net_payout: originalNetPayout } : {}),
  };
  let voidErr: unknown = null;
  let triedRejectedFallback = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    const { error } = await supabase.from("self_bills").update(voidPatch).eq("id", selfBillId);
    if (!error) {
      voidErr = null;
      break;
    }
    voidErr = error;
    const col = parsePostgrestUnknownColumnName(error);
    if (col && col in voidPatch && col !== "status") {
      delete voidPatch[col];
      continue;
    }
    if (isSupabaseMissingColumnError(error)) {
      // Drop the optional partner-facing columns and retry with the minimum set.
      delete voidPatch.payout_void_reason;
      delete voidPatch.partner_status_label;
      delete voidPatch.original_net_payout;
      continue;
    }
    /**
     * DB predates migration 100 (check constraint still forbids payout_* statuses).
     * Fall back to the "rejected" status — the Cancelled & Rejected tab accepts both,
     * so the row still moves out of the draft bucket.
     */
    const code = (error as { code?: string }).code;
    const msg = (error as { message?: string }).message ?? "";
    const isStatusCheck =
      code === "23514" ||
      msg.includes("self_bills_status_check") ||
      msg.includes("violates check constraint");
    if (isStatusCheck && !triedRejectedFallback) {
      voidPatch.status = "rejected";
      delete voidPatch.payout_void_reason;
      delete voidPatch.partner_status_label;
      delete voidPatch.original_net_payout;
      triedRejectedFallback = true;
      continue;
    }
    break;
  }
  if (voidErr) throw voidErr;
}

/** ISO week bucket follows job start (`scheduled_start_at` → `scheduled_date`). */
export function jobSelfBillPeriodAnchorYmd(
  job: Pick<Job, "scheduled_start_at" | "scheduled_date">,
): string | null {
  const fromStart = job.scheduled_start_at?.trim().slice(0, 10) ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromStart)) return fromStart;
  const fromSched = job.scheduled_date?.trim().slice(0, 10) ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromSched)) return fromSched;
  return null;
}

/** Self-bill link requires completed execution (`completed_date`). */
export function jobSelfBillCompletedGateYmd(job: Pick<Job, "completed_date">): string | null {
  const ymd = job.completed_date?.trim().slice(0, 10) ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

/** @deprecated Use `jobSelfBillPeriodAnchorYmd` — kept for imports during transition. */
export function jobSelfBillWeekAnchorYmd(
  job: Pick<Job, "scheduled_start_at" | "scheduled_date" | "completed_date">,
): string | null {
  return jobSelfBillPeriodAnchorYmd(job);
}

/** Draft weekly self-bill: partner assigned + scheduled week anchor (no completed_date). */
export function canDraftSelfBillForJob(
  job: Pick<Job, "partner_id" | "scheduled_start_at" | "scheduled_date">,
): boolean {
  return Boolean(job.partner_id?.trim() && jobSelfBillPeriodAnchorYmd(job));
}

export function canLinkJobToSelfBill(
  job: Pick<Job, "scheduled_start_at" | "scheduled_date" | "completed_date">,
): boolean {
  return Boolean(jobSelfBillCompletedGateYmd(job) && jobSelfBillPeriodAnchorYmd(job));
}

export function resolveJobSelfBillWeekAnchor(
  job: Pick<Job, "scheduled_start_at" | "scheduled_date">,
): Date | null {
  const ymd = jobSelfBillPeriodAnchorYmd(job);
  return ymd ? new Date(`${ymd}T12:00:00`) : null;
}

export type EnsureWeeklySelfBillOptions = {
  weekAnchorDate?: Date;
  dueCtx?: SelfBillDueResolveContext;
  client?: SupabaseClient;
  /**
   * Quando presente, o documento é da VISITA e não do job (mig 161).
   *
   * Self-bill é por parceiro: a visita 2 pode ser de outro parceiro e nunca
   * pode cair no documento do parceiro da visita 1. Com isto, o parceiro, a
   * data-âncora e o destino do vínculo vêm da visita, e o link é escrito em
   * `job_visits.self_bill_id` em vez de `jobs.self_bill_id`.
   */
  visit?: {
    id: string;
    partnerId: string;
    partnerName?: string | null;
    /** Data que decide o período de pagamento: conclusão, senão agendamento. */
    anchorYmd: string;
  };
};

export async function ensureWeeklySelfBillForJob(job: Job, options?: EnsureWeeklySelfBillOptions): Promise<string | null> {
  const visitScope = options?.visit ?? null;
  if (!visitScope && !job.partner_id?.trim()) return null;
  if (visitScope && !visitScope.partnerId.trim()) return null;
  /**
   * No escopo de visita o que vale é a visita: `canDraftSelfBillForJob` exige
   * parceiro e agenda NO JOB, e job sem parceiro primário é justamente o caso
   * que a mig 161 veio atender. Exigi-lo aqui deixaria o parceiro da visita
   * sem documento, em silêncio.
   */
  if (!visitScope && !canDraftSelfBillForJob(job)) return null;
  const supabase = options?.client ?? getSupabase();
  let partnerId = (visitScope?.partnerId ?? job.partner_id ?? "").trim();
  /** `self_bills.partner_id` FK → `partners.id`; jobs can still hold a stale/invalid UUID. */
  const { data: partnerRowInit, error: partnerLookupErr } = await supabase
    .from("partners")
    .select("id")
    .eq("id", partnerId)
    .maybeSingle();
  if (partnerLookupErr) throw partnerLookupErr;
  let partnerRow = partnerRowInit;
  if (!partnerRow?.id) {
    const partnerName = (visitScope?.partnerName ?? job.partner_name ?? "").trim();
    if (partnerName) {
      const byCompany = await supabase
        .from("partners")
        .select("id")
        .ilike("company_name", partnerName)
        .limit(1)
        .maybeSingle();
      if (byCompany.error) throw byCompany.error;
      if (byCompany.data?.id) {
        partnerRow = byCompany.data;
      } else {
        const byContact = await supabase
          .from("partners")
          .select("id")
          .ilike("contact_name", partnerName)
          .limit(1)
          .maybeSingle();
        if (byContact.error) throw byContact.error;
        if (byContact.data?.id) partnerRow = byContact.data;
      }
    }
    if (!partnerRow?.id) {
      throw new Error(
        "This partner is not in the directory (link broken or partner removed). Re-assign the partner on the job, then create the self-bill again.",
      );
    }
    partnerId = String(partnerRow.id).trim();
    if (!visitScope) {
      const { error: repairErr } = await supabase.from("jobs").update({ partner_id: partnerId }).eq("id", job.id);
      if (repairErr) throw repairErr;
    }
  }
  const anchor = visitScope
    ? new Date(`${visitScope.anchorYmd}T12:00:00`)
    : options?.weekAnchorDate ?? resolveJobSelfBillWeekAnchor(job);
  if (!anchor) return null;

  /**
   * A grade de quinzenas precisa de âncora fixa, senão ela FLUTUA.
   *
   * Sem `orgReferenceYmd`, `workPeriodForJobStartYmd` começa a contar a partir
   * da sexta seguinte à data de entrada e caminha de 14 em 14 — ou seja, cada
   * data gera sua própria grade. Medido em 23/08/2026: 26/08 caía no período
   * 24/08–06/09 e 29/08 no período 17/08–30/08, dois baldes sobrepostos. Foi
   * assim que uma visita de 29/08 foi parar num self-bill de outro job que já
   * estava em `awaiting_payment`.
   *
   * Ninguém passava `dueCtx`, então a leitura do Setup vem para cá.
   */
  let dueCtx = options?.dueCtx ?? null;
  if (!dueCtx) {
    try {
      const { data: cs } = await supabase
        .from("company_settings")
        .select("frontend_setup")
        .limit(1)
        .maybeSingle();
      const setup = parseFrontendSetup((cs as { frontend_setup?: unknown } | null)?.frontend_setup);
      dueCtx = {
        orgStandardTerms: resolveOrgPartnerPayoutStandardTerms(setup),
        orgReferenceYmd: normalizePartnerPayoutReferenceYmd(setup?.partner_payout_reference_ymd),
      };
    } catch {
      dueCtx = null;
    }
  }
  const orgTerms = dueCtx?.orgStandardTerms ?? null;
  const cadence = partnerPayoutCadenceFromTerms(orgTerms);

  /**
   * O balde é o PERÍODO DE PAGAMENTO, não a semana ISO.
   *
   * Até 20/08/2026 isto era `getWeekBoundsForDate`, e o resultado é que um
   * parceiro pago a cada quinze dias recebia um self-bill por semana: o
   * Fernando tinha QUATRO documentos vencendo todos em 21/08. Um parceiro, um
   * pagamento, um documento.
   *
   * `workPeriodForJobStartYmd` já existia e devolve exatamente a quinzena que o
   * dono descreve: cut-off no domingo, pagamento na sexta seguinte. Trabalho
   * feito entre 03 e 16/08 vira o pagamento de 21/08.
   *
   * Cai de volta na semana ISO quando o helper não sabe responder (cadência
   * fora do padrão), para nenhum job ficar sem self-bill por causa disto.
   */
  const anchorYmd = anchor.toISOString().slice(0, 10);
  const periodo = workPeriodForJobStartYmd(anchorYmd, orgTerms, dueCtx?.orgReferenceYmd ?? null);
  const semana = getWeekBoundsForDate(anchor);
  const weekStart = periodo?.periodStartYmd ?? semana.weekStart;
  const weekEnd = periodo?.periodEndYmd ?? semana.weekEnd;
  // O rótulo passa a ser o intervalo do período. `2026-W33` mentia: dizia
  // semana num documento que cobre duas.
  const weekLabel = periodo ? `${periodo.periodStartYmd} a ${periodo.periodEndYmd}` : semana.weekLabel;
  const dueDate =
    dueCtx && weekEnd
      ? computePartnerSelfBillDueIso(
          weekEnd,
          dueCtx.partnerTerms ?? null,
          dueCtx.orgStandardTerms,
          dueCtx.orgReferenceYmd,
        )
      : null;

  /**
   * A busca é pelo balde ABERTO, não por "uma linha qualquer deste período".
   *
   * Sem o filtro de status esta consulta pegava uma linha arbitrária: o
   * esquema antigo era um self-bill POR JOB, e há parceiro com dez documentos
   * `paid` na mesma semana. Vinha um `paid`, o código concluía "terminal" e
   * criava outro aberto ao lado — em silêncio, um segundo balde.
   *
   * A ordem existe para ser determinística e para casar com a reconciliação
   * pós-insert e com o índice único da mig 277: os três têm que eleger o mesmo
   * documento, senão discordam sobre quem é o balde.
   */
  const REUSAVEIS = [...SELF_BILL_REUSABLE_STATUSES];
  const { data: existing, error: selErr } = await supabase
    .from("self_bills")
    .select("id, status")
    .eq("partner_id", partnerId)
    .eq("week_start", weekStart)
    .in("status", REUSAVEIS)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (selErr) throw selErr;

  const existingRow = existing as { id: string; status: string } | null;
  // Terminal self-bills (voided / rejected) belong to their own history.
  // New jobs always get a fresh self-bill so they have no link to cancelled/rejected ones.
  /**
   * Só documento AINDA EM ABERTO recebe trabalho novo.
   *
   * `SELF_BILL_TERMINAL_STATUSES` não cobre `paid` nem `awaiting_payment`, e
   * pendurar uma visita num documento já em pagamento é dinheiro que some: o
   * refresh sai cedo e ninguém recebe. Aconteceu de verdade no teste — uma
   * visita entrou num self-bill de £248 já em awaiting_payment.
   */
  const isTerminal = existingRow ? !SELF_BILL_REUSABLE_STATUSES.has(existingRow.status) : false;
  let sbId = existingRow && !isTerminal ? (existingRow.id as string) : undefined;

  if (!sbId) {
    const ref = await nextSelfBillRef(supabase, weekLabel, job.reference);
    const row = {
      reference: ref,
      partner_id: partnerId,
      // Documento da visita leva o nome do parceiro DELA: sair com o nome do
      // handyman num self-bill do eletricista é erro que o parceiro vê no PDF.
      partner_name: (visitScope?.partnerName ?? job.partner_name)?.trim() || "Partner",
      bill_origin: "partner" as const,
      period: weekStart.slice(0, 7),
      week_start: weekStart,
      week_end: weekEnd,
      week_label: weekLabel,
      jobs_count: 0,
      job_value: 0,
      materials: 0,
      commission: 0,
      net_payout: 0,
      /**
       * `accumulating`, não `draft`.
       *
       * A constraint do banco nunca aceitou `draft` (migração 081), então este
       * insert falhava com 23514 e o bloco de recuperação abaixo reinseria como
       * `accumulating`. Dois round-trips e um erro no log em TODA criação de
       * self-bill, para chegar no mesmo lugar. `accumulating` é o estado real:
       * o self-bill do período existe e está juntando jobs.
       */
      status: "accumulating" as const,
      payment_cadence: cadence,
      ...(dueDate ? { due_date: dueDate } : {}),
    };
    let { data: ins, error: insErr } = await supabase.from("self_bills").insert(row).select("id").single();
    if (insErr && isSupabaseMissingColumnError(insErr, "bill_origin")) {
      const { bill_origin: _bo, ...rowLegacy } = row;
      ({ data: ins, error: insErr } = await supabase.from("self_bills").insert(rowLegacy).select("id").single());
    }
    if (insErr) {
      const code = (insErr as { code?: string }).code;
      const msg = insErr.message ?? "";
      const isFkPartner =
        code === "23503" || msg.includes("self_bills_partner_id_fkey") || msg.includes("foreign key constraint");
      if (isFkPartner) {
        throw new Error(
          "Partner is not in the directory (self_bills require a valid partners row). Re-assign the partner on the job, then try again.",
        );
      }
      /**
       * 23505 = o índice único da mig 277 recusou um segundo balde aberto para
       * este parceiro e período. Não é erro: é a garantia funcionando. Alguém
       * criou o balde entre a nossa busca e o nosso insert, e a recuperação
       * abaixo lê o vencedor e segue com ele.
       */
      const isDuplicateBucket =
        code === "23505" ||
        msg.includes("uq_self_bills_partner_period_open") ||
        msg.includes("duplicate key value");
      const isStatusCheck =
        !isDuplicateBucket &&
        (code === "23514" || msg.includes("self_bills_status_check") || msg.includes("violates check constraint"));
      if (isStatusCheck) {
        const { data: ins2, error: insErr2 } = await supabase
          .from("self_bills")
          .insert({ ...row, status: "accumulating" as const })
          .select("id")
          .single();
        if (!insErr2 && ins2) {
          sbId = ins2.id as string;
        } else if (insErr2) {
          const { data: race } = await supabase
            .from("self_bills")
            .select("id, status")
            .eq("partner_id", partnerId)
            .eq("week_start", weekStart)
            .in("status", REUSAVEIS)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          sbId = (race as { id: string } | null)?.id;
          if (!sbId) throw insErr2;
        }
      } else {
        const { data: race } = await supabase
          .from("self_bills")
          .select("id, status")
          .eq("partner_id", partnerId)
          .eq("week_start", weekStart)
          .in("status", REUSAVEIS)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        sbId = (race as { id: string } | null)?.id;

        /**
         * Sobrou o caso do documento CANCELADO no mesmo balde.
         *
         * O índice da mig 277 é PARCIAL — cobre só os estados abertos — então
         * um documento cancelado não barra o insert e este ramo praticamente
         * não é alcançado hoje. Fica de pé para o banco que ainda não tem o
         * índice e para colisão vinda de outra constraint: se o cancelado está
         * vazio, ele volta a valer, porque foi cancelado justamente por ter
         * ficado sem linha. Cancelado COM linha não se mexe: aquilo é
         * histórico.
         */
        if (!sbId) {
          const { data: terminal } = await supabase
            .from("self_bills")
            .select("id, status")
            .eq("partner_id", partnerId)
            .eq("week_start", weekStart)
            .limit(1)
            .maybeSingle();
          const terminalId = (terminal as { id: string } | null)?.id;
          if (terminalId) {
            const linhas = await loadSelfBillPayoutLines(terminalId, supabase);
            if (linhas.length === 0) {
              const reopen: Record<string, unknown> = {
                status: "accumulating",
                payout_void_reason: null,
                partner_status_label: null,
              };
              let { error: reErr } = await supabase.from("self_bills").update(reopen).eq("id", terminalId);
              if (reErr && isSupabaseMissingColumnError(reErr)) {
                delete reopen.payout_void_reason;
                delete reopen.partner_status_label;
                ({ error: reErr } = await supabase.from("self_bills").update(reopen).eq("id", terminalId));
              }
              if (!reErr) sbId = terminalId;
            }
          }
        }
        if (!sbId) throw insErr;
      }
    } else {
      if (!ins?.id) throw new Error("Self-bill insert returned no id");
      sbId = ins.id as string;

      /**
       * Reconciliação pós-insert: não existe índice único em
       * (partner_id, week_start).
       *
       * Duas criações simultâneas para o mesmo parceiro e período — duas
       * visitas adicionadas em sequência rápida — não encontram nada na busca
       * e inserem as duas. Medido em 23/08/2026: o LandLord ficou com
       * SB-14460 e SB-14461, mesmo parceiro, mesma quinzena.
       *
       * Aqui o documento mais antigo vence e o recém-criado (vazio) é
       * cancelado. Determinístico: quem chegar depois converge para o mesmo.
       */
      const { data: mesmos } = await supabase
        .from("self_bills")
        .select("id, created_at, status")
        .eq("partner_id", partnerId)
        .eq("week_start", weekStart)
        .order("created_at", { ascending: true });
      /**
       * Só concorre quem ainda aceita trabalho. Filtrar por
       * `SELF_BILL_TERMINAL_STATUSES` aqui era o furo: `awaiting_payment` não
       * está nessa lista, então o documento em pagamento "ganhava" a
       * reconciliação e recebia a visita — anulando a guarda de cima.
       */
      const lista = ((mesmos ?? []) as { id: string; status: string }[])
        .filter((r) => SELF_BILL_REUSABLE_STATUSES.has(r.status));
      if (lista.length > 1 && lista[0].id !== sbId) {
        const vencedor = lista[0].id;
        const meu = sbId;
        const linhasDoMeu = await loadSelfBillPayoutLines(meu, supabase);
        if (linhasDoMeu.length === 0) {
          await cancelSelfBillsByIds([meu]).catch((e) => {
            console.error("could not cancel duplicate self-bill", e);
          });
          sbId = vencedor;
        }
      }
    }
  }

  if (!sbId) throw new Error("Failed to create or find weekly self-bill");

  const { error: linkErr } = visitScope
    ? await supabase.from("job_visits").update({ self_bill_id: sbId }).eq("id", visitScope.id)
    : await supabase.from("jobs").update({ self_bill_id: sbId }).eq("id", job.id);
  if (linkErr) throw linkErr;

  /**
   * Passa o MESMO client. Sem isto o refresh caía no client de browser com a
   * chave anon: rodando no servidor, ele lia zero linha de `job_visits` (RLS
   * `TO authenticated`, mig 161) sem erro nenhum e reescrevia o `net_payout`
   * sem o dinheiro da visita.
   */
  await refreshSelfBillPayoutState(sbId, supabase).catch((e) => {
    console.error("refreshSelfBillPayoutState after weekly self-bill link:", e);
  });
  return sbId;
}

/**
 * Self-bill do parceiro de UMA visita (mig 161).
 *
 * Mesmo balde de sempre — parceiro x período de pagamento — só que a âncora é
 * a data da visita e o vínculo mora em `job_visits.self_bill_id`. Job com dois
 * parceiros passa a ter dois documentos, cada um com o valor do seu.
 */
export async function ensureWeeklySelfBillForVisit(
  job: Job,
  visit: { id: string; partner_id?: string | null; partner_name?: string | null; scheduled_date?: string | null; completed_at?: string | null },
  options?: Omit<EnsureWeeklySelfBillOptions, "visit">,
): Promise<string | null> {
  const partnerId = visit.partner_id?.trim();
  if (!partnerId) return null;
  // Visita que escorregou da data agendada cai no período em que foi feita.
  /**
   * Dia de Londres, não UTC: visita fechada 00:30 no BST gravaria o dia
   * anterior, e num domingo de corte cairia na quinzena já paga. É o mesmo
   * erro do "Checkatrade: data um dia atrás".
   */
  const completedYmd = visit.completed_at
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
        .format(new Date(visit.completed_at))
    : null;
  const anchorYmd = (completedYmd || visit.scheduled_date?.slice(0, 10) || "").trim();
  // Data suja vira `Invalid Date`, que é truthy: passaria o guard e estouraria
  // em `toISOString()` dentro de um try/catch que engole o erro.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorYmd)) return null;
  if (Number.isNaN(new Date(`${anchorYmd}T12:00:00`).getTime())) return null;
  return ensureWeeklySelfBillForJob(job, {
    ...options,
    visit: { id: visit.id, partnerId, partnerName: visit.partner_name ?? null, anchorYmd },
  });
}

/**
 * Solta a visita do self-bill dela e acerta o documento.
 *
 * Usado ao excluir e ao reabrir uma visita. Duas coisas têm que acontecer na
 * ordem: o vínculo sai (senão a linha continua sendo somada) e o documento é
 * recalculado (senão o `net_payout` fica com dinheiro de trabalho que não
 * existe mais). Se o documento ficar sem nenhuma linha, ele é cancelado — um
 * self-bill de £0 aberto no Money Out é ruído que alguém acaba pagando.
 */
export type DetachVisitResult =
  /** Soltou (ou não havia vínculo): o chamador pode religar a visita. */
  | { detached: true }
  /**
   * O documento já foi pago ou encerrado. O vínculo NÃO foi solto e a visita
   * não pode ser religada em lugar nenhum.
   */
  | { detached: false; lockedSelfBillId: string; status: string };

export async function detachVisitFromSelfBill(
  visitId: string,
  client?: SupabaseClient,
  options?: { cancelIfEmpty?: boolean },
): Promise<DetachVisitResult> {
  const supabase = client ?? getSupabase();
  const { data: row, error: readErr } = await supabase
    .from("job_visits")
    .select("self_bill_id")
    .eq("id", visitId)
    .maybeSingle();
  if (readErr) {
    // Ambiente sem a mig 276 não tem a coluna: não há vínculo para soltar.
    if (isSupabaseMissingColumnError(readErr, "self_bill_id")) return { detached: true };
    throw readErr;
  }
  const sbId = (row as { self_bill_id?: string | null } | null)?.self_bill_id ?? null;
  if (!sbId) return { detached: true };

  /**
   * O status vem ANTES de soltar o vínculo.
   *
   * Soltar primeiro e só depois olhar o status pagava a mesma visita duas
   * vezes: o vínculo saía do documento PAGO (que não é recalculado, o dinheiro
   * já saiu), e o `ensure` seguinte não enxerga documento pago como balde
   * reutilizável, então nascia um documento novo com o valor CHEIO da visita.
   * Visita de £70 já paga, corrigida para £80, virava £70 + £80.
   *
   * Documento pago é histórico: a visita fica presa nele e a diferença tem que
   * virar ajuste explícito, nunca reemissão.
   */
  const { data: sb } = await supabase.from("self_bills").select("status").eq("id", sbId).maybeSingle();
  const status = (sb as { status?: string } | null)?.status ?? "";
  if (status === "paid" || SELF_BILL_TERMINAL_STATUSES.includes(status as SelfBillStatus)) {
    return { detached: false, lockedSelfBillId: sbId, status };
  }

  const { error: unlinkErr } = await supabase
    .from("job_visits")
    .update({ self_bill_id: null })
    .eq("id", visitId);
  if (unlinkErr) throw unlinkErr;

  const remaining = await loadSelfBillPayoutLines(sbId, supabase);
  /**
   * Cancelar só quando o chamador pede (exclusão de visita).
   *
   * Reatar a mesma visita depois de uma edição passava por aqui, cancelava o
   * documento vazio, e o ensure seguinte tentava criar outro para o MESMO
   * parceiro e período — colidindo no índice único e derrubando o vínculo.
   * Editar visita não pode encostar no ciclo de vida do documento.
   */
  if (options?.cancelIfEmpty && remaining.length === 0) {
    const { data: anyJob } = await supabase
      .from("jobs")
      .select("id")
      .eq("self_bill_id", sbId)
      .limit(1)
      .maybeSingle();
    const { data: anyVisit } = await supabase
      .from("job_visits")
      .select("id")
      .eq("self_bill_id", sbId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    // Vazio de verdade (nem linha pagável, nem trabalho ainda por fechar).
    if (!anyJob && !anyVisit) {
      await cancelSelfBillsByIds([sbId]);
      return { detached: true };
    }
  }
  await refreshSelfBillPayoutState(sbId, supabase);
  return { detached: true };
}

/** Office cancel: void self-bill(s) and unlink jobs so refresh/sync cannot reopen them. */
export async function cancelSelfBillsByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const supabase = getSupabase();
  const patch: Record<string, unknown> = {
    status: "payout_cancelled",
    partner_status_label: "Cancelled",
    jobs_count: 0,
    job_value: 0,
    materials: 0,
    commission: 0,
    net_payout: 0,
  };
  let lastErr: unknown = null;
  let triedRejectedFallback = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    const { error } = await supabase.from("self_bills").update(patch).in("id", ids);
    if (!error) {
      lastErr = null;
      break;
    }
    lastErr = error;
    const code = (error as { code?: string }).code;
    const msg = (error as { message?: string }).message ?? "";
    if (code === "PGRST204" || msg.includes("schema cache") || msg.includes("Could not find")) {
      delete patch.partner_status_label;
      continue;
    }
    if (
      (code === "23514" || msg.includes("self_bills_status_check") || msg.includes("violates check constraint")) &&
      !triedRejectedFallback
    ) {
      patch.status = "rejected";
      delete patch.partner_status_label;
      triedRejectedFallback = true;
      continue;
    }
    break;
  }
  if (lastErr) throw lastErr;

  const { error: unlinkErr } = await supabase.from("jobs").update({ self_bill_id: null }).in("self_bill_id", ids);
  if (unlinkErr) throw unlinkErr;

  /**
   * A visita também solta.
   *
   * Sem isto ela ficava apontando para um documento cancelado para sempre:
   * `detachVisitFromSelfBill` se recusa a mexer em documento terminal, então
   * ninguém mais desfazia o vínculo, e o `ensure` seguinte criava um documento
   * novo deixando o ponteiro velho pendurado.
   */
  const { error: unlinkVisitErr } = await supabase
    .from("job_visits")
    .update({ self_bill_id: null })
    .in("self_bill_id", ids);
  if (unlinkVisitErr) {
    const code = (unlinkVisitErr as { code?: string }).code;
    if (!isSupabaseMissingColumnError(unlinkVisitErr) && code !== "42P01") throw unlinkVisitErr;
  }
}

export async function syncSelfBillAfterJobChange(job: Job): Promise<void> {
  const tasks: Promise<void>[] = [];
  /**
   * Todos os documentos do job, não só o da coluna: com visita de outro
   * parceiro, mudar o job mexia num documento e deixava o outro parado com
   * valor velho.
   */
  const alvos = job.id
    ? await selfBillIdsTouchedByJob([job.id]).catch((e) => {
        console.error("syncSelfBillAfterJobChange: falha ao listar documentos do job", e);
        return job.self_bill_id ? [job.self_bill_id] : [];
      })
    : job.self_bill_id
      ? [job.self_bill_id]
      : [];
  for (const sbId of alvos) {
    tasks.push(
      refreshSelfBillPayoutState(sbId).catch((e) => {
        console.error("syncSelfBillAfterJobChange partner refresh failed:", e);
      }),
    );
  }
  if (job.id) {
    tasks.push(
      import("./workforce-self-bills")
        .then(({ refreshWorkforceSelfBillsForJobIds }) => refreshWorkforceSelfBillsForJobIds([job.id]))
        .catch((e) => {
          console.error("syncSelfBillAfterJobChange workforce refresh failed:", e);
        }),
    );
  }
  if (tasks.length === 0) return;
  await Promise.all(tasks);
}

/** After bulk job updates that bypass `updateJob`, refresh every linked weekly self-bill. */
export async function refreshSelfBillPayoutStatesForJobIds(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  // Inclui os documentos das visitas: ver `selfBillIdsTouchedByJob`.
  let sbIds: string[];
  try {
    sbIds = await selfBillIdsTouchedByJob(jobIds);
  } catch (error) {
    console.error("refreshSelfBillPayoutStatesForJobIds:", error);
    return;
  }
  await Promise.all(sbIds.map((bid) => refreshSelfBillPayoutState(bid).catch((e) => console.error("refreshSelfBillPayoutState", bid, e))));
}

export async function listSelfBillsLinkedToJob(
  jobReference: string,
  primarySelfBillId?: string | null,
  client?: SupabaseClient,
): Promise<SelfBill[]> {
  const supabase = client ?? getSupabase();
  const { data: jobRow, error: jobErr } = await supabase
    .from("jobs")
    .select("self_bill_id")
    .eq("reference", jobReference)
    .is("deleted_at", null)
    .maybeSingle();
  if (jobErr) throw jobErr;
  const ids = new Set<string>();
  if (jobRow?.self_bill_id) ids.add(jobRow.self_bill_id as string);
  if (primarySelfBillId) ids.add(primarySelfBillId);

  /**
   * Documentos das VISITAS deste job (mig 161/276).
   *
   * Um job com dois parceiros tem dois self-bills, e o card precisa mostrar os
   * dois — senão o parceiro da visita aparece sem documento na tela e o
   * cancelamento do job deixa o payout dele vivo.
   */
  const { data: jobIdRow } = await supabase
    .from("jobs")
    .select("id")
    .eq("reference", jobReference)
    .is("deleted_at", null)
    .maybeSingle();
  const jobId = (jobIdRow as { id?: string } | null)?.id;
  if (jobId) {
    const { data: visitRows, error: visitErr } = await supabase
      .from("job_visits")
      .select("self_bill_id")
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .not("self_bill_id", "is", null);
    // Ambiente sem a mig 276 devolve erro: o card segue com o documento do job.
    if (!visitErr) {
      for (const v of (visitRows ?? []) as { self_bill_id: string | null }[]) {
        if (v.self_bill_id) ids.add(v.self_bill_id);
      }
    }
  }
  if (ids.size === 0) return [];
  const { data, error } = await supabase.from("self_bills").select("*").in("id", [...ids]);
  if (error) throw error;
  const rows = (data ?? []) as SelfBill[];
  if (primarySelfBillId && !rows.some((r) => r.id === primarySelfBillId)) {
    const { data: primary } = await supabase.from("self_bills").select("*").eq("id", primarySelfBillId).maybeSingle();
    const p = primary as SelfBill | null;
    if (p) rows.unshift(p);
  }
  return rows;
}

/**
 * When a job is cancelled, mark linked self-bills as payout-cancelled (void-like state).
 * Skips paid / already voided rows and never sends anything.
 */
export async function cancelOpenSelfBillsForJobCancellation(
  options: {
    jobReference: string;
    primarySelfBillId?: string | null;
  },
  client?: SupabaseClient,
): Promise<void> {
  const supabaseForList = client ?? getSupabase();
  const linked = await listSelfBillsLinkedToJob(options.jobReference, options.primarySelfBillId, supabaseForList);
  const eligible = linked.filter((sb) => {
    if (sb.status === "paid") return false;
    if (SELF_BILL_TERMINAL_STATUSES.includes(sb.status)) return false;
    return true;
  });
  if (eligible.length === 0) return;

  const supabase = client ?? getSupabase();

  // For weekly self-bills with multiple jobs, only void when no active jobs remain.
  await Promise.all(eligible.map(async (sb) => {
    const { data: activeJobs } = await supabase
      .from("jobs")
      .select("id")
      .eq("self_bill_id", sb.id)
      .not("status", "in", "(cancelled,deleted)")
      .is("deleted_at", null)
      .limit(1);
    if (activeJobs?.length) return; // other active jobs remain — leave self-bill intact
    /**
     * Visita viva também segura o documento.
     *
     * Sem isto, cancelar um job zerava um documento que carrega a visita de
     * OUTRO job do mesmo parceiro no mesmo período — dinheiro de trabalho que
     * ninguém cancelou. `loadSelfBillPayoutLines` já descarta visita de job
     * morto, então o que sobra aqui é trabalho vivo de verdade.
     */
    const linhasVivas = await loadSelfBillPayoutLines(sb.id, supabase).catch(() => []);
    if (linhasVivas.some((l) => l.kind === "visit")) return;
    const patch: Record<string, unknown> = {
      status: "payout_cancelled" as const,
      partner_status_label: "Cancelled",
      jobs_count: 0,
      job_value: 0,
      materials: 0,
      commission: 0,
      net_payout: 0,
    };
    // Progressive retries: drop unknown columns (PGRST204), then fall back to
    // `rejected` when payout_cancelled is not in the status CHECK yet.
    // Important: use the *latest* error for the check-constraint test — the old
    // path retried without partner_status_label but still threw the original
    // PGRST204 when payout_cancelled was also rejected.
    let lastErr: unknown = null;
    let triedRejectedFallback = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const { error } = await supabase.from("self_bills").update(patch).eq("id", sb.id);
      if (!error) {
        lastErr = null;
        break;
      }
      lastErr = error;
      const col = parsePostgrestUnknownColumnName(error);
      if (col && col in patch && col !== "status") {
        delete patch[col];
        continue;
      }
      if (isSupabaseMissingColumnError(error)) {
        delete patch.partner_status_label;
        delete patch.payout_void_reason;
        continue;
      }
      if (isPostgresCheckViolationError(error) && !triedRejectedFallback) {
        patch.status = "rejected";
        delete patch.partner_status_label;
        delete patch.payout_void_reason;
        triedRejectedFallback = true;
        continue;
      }
      break;
    }
    if (lastErr) throw lastErr;
  }));
}

export type CreateSelfBillFromJobOptions = {
  /** When set (e.g. Review & approve), weekly bucket follows this instant instead of scheduled/created date. */
  weekAnchorDate?: Date;
};

export async function createSelfBillFromJob(
  job: CreateSelfBillFromJobInput,
  options?: CreateSelfBillFromJobOptions,
): Promise<SelfBill> {
  const supabase = getSupabase();
  const { data: full, error: fullErr } = await supabase.from("jobs").select("*").eq("id", job.id).single();
  if (fullErr) throw fullErr;
  if (!full) throw new Error("Job not found");
  const j = full as Job;
  if (!canDraftSelfBillForJob(j)) {
    throw new Error("Job must have a partner and scheduled start date before creating a self-bill");
  }
  const weekAnchorDate = options?.weekAnchorDate ?? resolveJobSelfBillWeekAnchor(j);
  if (!weekAnchorDate) throw new Error("Job must have a scheduled start date for self-bill week");
  const id = await ensureWeeklySelfBillForJob(j, { weekAnchorDate });
  if (!id) throw new Error("Partner required for self-bill");
  const row = await getSelfBill(id);
  if (!row) throw new Error("Self-bill not found after create");
  return row;
}

export async function getSelfBill(id: string): Promise<SelfBill | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("self_bills").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as SelfBill) ?? null;
}

export async function updateSelfBillStatus(id: string, status: SelfBillStatus): Promise<SelfBill> {
  return updateSelfBill(id, { status });
}

export async function updateSelfBill(
  id: string,
  patch: Partial<Pick<SelfBill, "status" | "due_date">>,
): Promise<SelfBill> {
  const supabase = getSupabase();
  const requestedStatus = patch.status;
  const statusFallbacks: SelfBillStatus[] =
    requestedStatus === "awaiting_payment"
      ? ["pending_review", "ready_to_pay", "accumulating"]
      : requestedStatus === "ready_to_pay"
        ? ["pending_review", "accumulating"]
        : [];

  let lastErr: unknown = null;

  for (let statusTry = 0; statusTry <= statusFallbacks.length; statusTry++) {
    let payload: Record<string, unknown> = { ...patch };
    if (statusTry > 0 && requestedStatus) {
      payload.status = statusFallbacks[statusTry - 1];
    }

    for (let attempt = 0; attempt < 12; attempt++) {
      const { data, error } = await supabase
        .from("self_bills")
        .update(payload)
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (!error && data) return data as SelfBill;

      lastErr = error;
      if (!error) {
        const row = await getSelfBill(id);
        if (row) return row;
        break;
      }

      if (payload.due_date != null && isSupabaseMissingColumnError(error, "due_date")) {
        const { due_date: _d, ...withoutDue } = payload;
        payload = withoutDue;
        if (Object.keys(payload).length === 0) {
          const row = await getSelfBill(id);
          if (!row) throw error;
          return row;
        }
        continue;
      }

      const col = parsePostgrestUnknownColumnName(error);
      if (col && col in payload && col !== "status") {
        delete payload[col];
        continue;
      }

      if (
        isPostgresCheckViolationError(error) &&
        "status" in payload &&
        statusTry < statusFallbacks.length
      ) {
        break;
      }

      if (Object.keys(payload).length === 0) {
        const row = await getSelfBill(id);
        if (!row) throw error;
        return row;
      }

      throw error;
    }
  }

  if (lastErr) throw lastErr;
  const row = await getSelfBill(id);
  if (!row) throw new Error("Self-bill update failed");
  return row;
}

export async function listJobsForSelfBill(selfBillId: string): Promise<SelfBillJobLine[]> {
  const supabase = getSupabase();
  const rows = await fetchJobLinesForSelfBill(supabase, { selfBillId }, false);
  return rows as SelfBillJobLine[];
}

const SELF_BILL_JOB_QUERY_CHUNK = 60;

/** Jobs linked to any of the given self-bills (chunked `.in()` + legacy column fallback). */
export async function listJobsLinkedToSelfBillIds(selfBillIds: string[]): Promise<SelfBillLinkedJobRow[]> {
  if (selfBillIds.length === 0) return [];
  const supabase = getSupabase();
  const out: SelfBillLinkedJobRow[] = [];
  for (let i = 0; i < selfBillIds.length; i += SELF_BILL_JOB_QUERY_CHUNK) {
    const chunk = selfBillIds.slice(i, i + SELF_BILL_JOB_QUERY_CHUNK);
    const rows = (await fetchJobLinesForSelfBill(supabase, { selfBillIds: chunk }, true)) as SelfBillLinkedJobRow[];
    out.push(...rows);
  }
  return out;
}
