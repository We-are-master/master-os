import type { Job, JobVisit } from "@/types/database";

/**
 * Visita extra no dia dela (fase 1, 22/10/2026).
 *
 * Tudo que funciona por data (lista de Jobs, e-mail de amanhã ao parceiro, rota
 * do dia, lembrete de véspera) lia só `jobs.scheduled_date`. Uma visita futura de
 * um job já em Final review sumia: JOB-9705 tinha a V3 em 23/10 com TM Handyman e
 * ela não aparecia em lugar nenhum. Aqui mora a regra de quais visitas entram num
 * período e como uma visita vira uma linha com cara de job. Só leitura: o ciclo
 * do job continua sendo o do job.
 */

export type VisitWithParent = JobVisit & { parent: Job | null };

/** Linha de visita na lista: id é o da visita, o resto vem do job. */
export type VisitJobRow = Job & {
  __visit_parent_id: string;
  __visit_id: string;
  __visit_index: number;
};

/** Visita que ainda vai acontecer ou está acontecendo. */
export const OPEN_VISIT_STATUSES = ["scheduled", "in_progress"] as const;

/** Estágios em que a linha do próprio job já aparece no dia (Scheduled / In progress). */
export const JOB_FIELD_STATUSES = new Set(["scheduled", "late", "in_progress"]);

const PARENT_GONE = new Set(["cancelled", "deleted"]);

export function isOpenVisit(v: Pick<JobVisit, "status" | "deleted_at">): boolean {
  return !v.deleted_at && (OPEN_VISIT_STATUSES as readonly string[]).includes(v.status);
}

function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) ? ta === tb : a === b;
}

/**
 * A data e a janela do job já são as desta visita. Acontece quando o Done da V1
 * leva o job para a próxima visita (copia data e janela dela para o job) e quando
 * a visita foi marcada no mesmo horário do job. Aí a linha do job já é a visita.
 */
export function visitMatchesJobSlot(
  job: Pick<Job, "scheduled_date" | "scheduled_start_at">,
  v: Pick<JobVisit, "scheduled_date" | "scheduled_start_at">,
): boolean {
  if (!v.scheduled_date || v.scheduled_date !== (job.scheduled_date ?? null)) return false;
  return sameInstant(v.scheduled_start_at ?? null, job.scheduled_start_at ?? null);
}

/** Parceiro de quem a visita é: o dela, ou o do job quando a visita não tem. */
export function visitPartnerId(v: VisitWithParent): string | null {
  return v.partner_id?.trim() || v.parent?.partner_id?.trim() || null;
}

export function visitPartnerName(v: VisitWithParent): string | null {
  if (v.partner_id?.trim()) return v.partner_name?.trim() || null;
  return v.parent?.partner_name?.trim() || null;
}

/**
 * As visitas que entram num período, cada uma uma vez.
 *
 *  - só visita aberta (scheduled / in_progress), com data, dentro de [from, to];
 *  - job pai existe e não foi cancelado nem apagado;
 *  - visita que é o próprio horário do job sai quando a linha do job já aparece
 *    naquele lugar (`jobRowShown`), senão o dia teria a mesma parada duas vezes.
 */
export function selectVisitsInRange(
  rows: VisitWithParent[],
  range: { from?: string | null; to?: string | null },
  jobRowShown: (job: Job) => boolean = (j) => JOB_FIELD_STATUSES.has(String(j.status)),
): VisitWithParent[] {
  const out: VisitWithParent[] = [];
  const vistos = new Set<string>();
  for (const v of rows) {
    if (vistos.has(v.id)) continue;
    const parent = v.parent;
    if (!parent || parent.deleted_at || PARENT_GONE.has(String(parent.status))) continue;
    if (!isOpenVisit(v)) continue;
    const dia = v.scheduled_date ?? null;
    if (!dia) continue;
    if (range.from && dia < range.from) continue;
    if (range.to && dia > range.to) continue;
    if (visitMatchesJobSlot(parent, v) && jobRowShown(parent)) continue;
    vistos.add(v.id);
    out.push(v);
  }
  return out;
}

/** Em qual aba da lista a visita mora: a do status dela. */
export function visitJobsTab(v: Pick<JobVisit, "status">): "scheduled" | "in_progress" | null {
  if (v.status === "scheduled") return "scheduled";
  if (v.status === "in_progress") return "in_progress";
  return null;
}

export function visitReference(parentReference: string, visitIndex: number): string {
  return `${parentReference} · V${visitIndex}`;
}

/**
 * A visita como linha de job: endereço, cliente e ticket do job; data, janela,
 * parceiro, status e dinheiro da visita. Os totais da aba somam só o que a visita
 * vale, então extras, promoção e fatura do job ficam de fora da linha.
 */
export function visitAsJobRow(v: VisitWithParent): VisitJobRow {
  const parent = v.parent as Job;
  const row: VisitJobRow = {
    ...parent,
    id: v.id,
    reference: visitReference(parent.reference, v.visit_index),
    status: v.status === "in_progress" ? "in_progress" : "scheduled",
    scheduled_date: v.scheduled_date ?? undefined,
    scheduled_start_at: v.scheduled_start_at ?? undefined,
    scheduled_end_at: v.scheduled_end_at ?? undefined,
    scheduled_finish_date: v.scheduled_date ?? null,
    expected_finish_at: v.expected_finish_at ?? null,
    partner_id: visitPartnerId(v) ?? undefined,
    partner_name: visitPartnerName(v) ?? undefined,
    partner_ids: undefined,
    client_price: Number(v.client_price ?? 0),
    partner_cost: Number(v.partner_cost ?? 0),
    materials_cost: Number(v.materials_cost ?? 0),
    extras_amount: 0,
    partner_extras_amount: 0,
    promotion_amount: 0,
    invoice_id: undefined,
    self_bill_id: v.self_bill_id ?? undefined,
    route_seq: null,
    primary_visit_done: null,
    __visit_parent_id: parent.id,
    __visit_id: v.id,
    __visit_index: v.visit_index,
  } as VisitJobRow;
  return row;
}

export function isVisitJobRow(job: Job): job is VisitJobRow {
  return Boolean((job as Partial<VisitJobRow>).__visit_parent_id);
}

/** O job que a linha representa: o pai, quando é visita. */
export function jobIdOfRow(job: Job): string {
  return isVisitJobRow(job) ? job.__visit_parent_id : job.id;
}

/** Abrir a linha: o job, já na visita quando é linha de visita. */
export function jobRowHref(job: Job): string {
  return isVisitJobRow(job)
    ? `/jobs/${job.__visit_parent_id}?visit=${encodeURIComponent(job.__visit_id)}`
    : `/jobs/${job.id}`;
}
