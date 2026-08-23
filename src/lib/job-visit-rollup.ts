import type { Job, JobVisit } from "@/types/database";

/**
 * Roll-up do dinheiro de um job com múltiplas visitas.
 *
 * Modelo (mig 161): **visita 1 é o próprio job** — `jobs.client_price`,
 * `partner_cost` e `materials_cost` são o dinheiro DELA, não do job inteiro.
 * Visitas 2+ são linhas em `job_visits` e SOMAM por cima.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ REGRA QUE NÃO PODE SER QUEBRADA                                      │
 * │ `total_partner_cost` (e `partnerCostTotal` aqui) servem para exibição │
 * │ e margem. NADA que paga parceiro pode lê-los: self-bill é por         │
 * │ parceiro, e visitas do mesmo job podem ter parceiros diferentes.      │
 * │ Payout lê linha por linha — `jobs` para a visita 1, `job_visits`      │
 * │ para as demais. Ver comentário em `supabase/migrations/274_*.sql`.    │
 * └──────────────────────────────────────────────────────────────────────┘
 */

/** Uma visita na forma que o dinheiro enxerga: a 1 vem do job, as outras da tabela. */
export type VisitMoneyLine = {
  /** 1 = o próprio job. */
  visitIndex: number;
  /** `null` na visita 1 (a linha é o job). */
  visitId: string | null;
  partnerId: string | null;
  partnerName: string | null;
  clientPrice: number;
  partnerCost: number;
  materialsCost: number;
  scheduledDate: string | null;
  scheduledStartAt: string | null;
};

export type JobVisitRollup = {
  /** Inclui a visita 1, então nunca é zero. */
  visitCount: number;
  clientPriceTotal: number;
  partnerCostTotal: number;
  materialsCostTotal: number;
  perVisit: VisitMoneyLine[];
};

function money(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * O ÚNICO predicado de "esta visita conta como dinheiro".
 *
 * A mesma regra está escrita em SQL no trigger `tg_recompute_job_visit_rollup`
 * (mig 274). Mudou aqui, muda lá — e vice-versa.
 */
export function visitCountsForMoney(visit: Pick<JobVisit, "deleted_at" | "status">): boolean {
  return !visit.deleted_at && visit.status !== "cancelled";
}

/** Visita 1 a partir do job. Espelha `jobToPrimaryVisit` sem os campos que o dinheiro ignora. */
function primaryLineFromJob(job: Pick<Job,
  "client_price" | "partner_cost" | "materials_cost" | "partner_id" | "partner_name" |
  "scheduled_date" | "scheduled_start_at">): VisitMoneyLine {
  return {
    visitIndex: 1,
    visitId: null,
    partnerId: job.partner_id ?? null,
    partnerName: job.partner_name ?? null,
    clientPrice: money(job.client_price),
    partnerCost: money(job.partner_cost),
    materialsCost: money(job.materials_cost),
    scheduledDate: job.scheduled_date ?? null,
    scheduledStartAt: job.scheduled_start_at ?? null,
  };
}

/**
 * Roll-up a partir das linhas de verdade: o job (visita 1) + as visitas vivas.
 * É a versão exata — use sempre que as visitas já estiverem carregadas.
 */
export function rollUpJobVisits(
  job: Pick<Job,
    "client_price" | "partner_cost" | "materials_cost" | "partner_id" | "partner_name" |
    "scheduled_date" | "scheduled_start_at">,
  visits: JobVisit[] | null | undefined,
): JobVisitRollup {
  const live = (visits ?? []).filter(visitCountsForMoney);
  const perVisit: VisitMoneyLine[] = [
    primaryLineFromJob(job),
    ...live
      .slice()
      .sort((a, b) => a.visit_index - b.visit_index)
      .map((v) => ({
        visitIndex: v.visit_index,
        visitId: v.id,
        partnerId: v.partner_id ?? null,
        partnerName: v.partner_name ?? null,
        clientPrice: money(v.client_price),
        partnerCost: money(v.partner_cost),
        materialsCost: money(v.materials_cost),
        scheduledDate: v.scheduled_date ?? null,
        scheduledStartAt: v.scheduled_start_at ?? null,
      })),
  ];

  return {
    visitCount: perVisit.length,
    clientPriceTotal: round2(perVisit.reduce((s, l) => s + l.clientPrice, 0)),
    partnerCostTotal: round2(perVisit.reduce((s, l) => s + l.partnerCost, 0)),
    materialsCostTotal: round2(perVisit.reduce((s, l) => s + l.materialsCost, 0)),
    perVisit,
  };
}

/**
 * Roll-up para quem só tem a linha de `jobs` na mão (lista, KPI, query SQL).
 * Lê as colunas desnormalizadas que o trigger mantém; cai na visita 1 quando
 * o banco ainda não tem as colunas (ambiente antigo).
 *
 * `perVisit` traz só a visita 1 — sem as linhas, não há como abrir o resto.
 */
export function rollupFromStoredColumns(job: Pick<Job,
  "client_price" | "partner_cost" | "materials_cost" | "partner_id" | "partner_name" |
  "scheduled_date" | "scheduled_start_at" | "visits_count" |
  "total_client_price" | "total_partner_cost" | "total_materials_cost">): JobVisitRollup {
  const primary = primaryLineFromJob(job);
  const storedCount = Number(job.visits_count ?? 0);
  const hasRollup = storedCount >= 1;
  return {
    visitCount: hasRollup ? storedCount : 1,
    clientPriceTotal: hasRollup ? round2(money(job.total_client_price)) : primary.clientPrice,
    partnerCostTotal: hasRollup ? round2(money(job.total_partner_cost)) : primary.partnerCost,
    materialsCostTotal: hasRollup ? round2(money(job.total_materials_cost)) : primary.materialsCost,
    perVisit: [primary],
  };
}

/** O job tem visita além da primeira? Porta de várias regras (extras, gate, payout). */
export function jobHasExtraVisits(rollup: JobVisitRollup): boolean {
  return rollup.visitCount > 1;
}

/**
 * Receita do cliente somando as visitas. `extras_amount` continua no nível do
 * job (extras não são por visita até a etapa 5).
 */
export function jobTotalBillableRevenue(
  job: Pick<Job, "extras_amount">,
  rollup: JobVisitRollup,
): number {
  return round2(rollup.clientPriceTotal + money(job.extras_amount));
}

/** Custo direto somando as visitas: mão de obra + materiais de todas elas. */
export function jobTotalDirectCost(rollup: JobVisitRollup): number {
  return round2(rollup.partnerCostTotal + rollup.materialsCostTotal);
}

export function jobTotalProfit(job: Pick<Job, "extras_amount">, rollup: JobVisitRollup): number {
  return round2(jobTotalBillableRevenue(job, rollup) - jobTotalDirectCost(rollup));
}

export function jobTotalMarginPercent(job: Pick<Job, "extras_amount">, rollup: JobVisitRollup): number {
  const revenue = jobTotalBillableRevenue(job, rollup);
  if (revenue <= 0) return 0;
  return Math.round((jobTotalProfit(job, rollup) / revenue) * 1000) / 10;
}

/**
 * Teto de pagamento de UMA visita. Não existe `partner_agreed_value` por visita:
 * o override do job vale só para a visita 1.
 */
export function visitPaymentCap(visit: Pick<JobVisit, "partner_cost">): number {
  return money(visit.partner_cost);
}

/**
 * Teto do escopo que está sendo pago: a visita, quando informada; senão o job
 * (visita 1), onde `partner_agreed_value` ainda manda.
 */
export function partnerCapForScope(
  job: Pick<Job, "partner_agreed_value" | "partner_cost">,
  visit: Pick<JobVisit, "partner_cost"> | null,
): number {
  if (visit) return visitPaymentCap(visit);
  const agreed = money(job.partner_agreed_value);
  return agreed > 0 ? agreed : money(job.partner_cost);
}
