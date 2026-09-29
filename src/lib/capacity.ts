/**
 * Capacidade e elegibilidade lidas do banco. A regra mora em
 * `elegibilidade-parceiro.ts` (pura, testada); aqui só se carrega o que ela
 * precisa: parceiros ativos, jobs do período e o catálogo com a categoria.
 *
 * Quem usa:
 *  - `/api/public/capacity` (site e Harvey escondem dia sem vaga)
 *  - `matchPartnerIdsForWork` (quem recebe a oferta)
 *  - `scripts/auto-assign-ensaio.mts` (explica cada exclusão)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  avaliarParceiro,
  vagasNaCategoria,
  type Avaliacao,
  type Catalogo,
  type JobParaEscala,
  type ParceiroParaEscala,
} from "@/lib/elegibilidade-parceiro";

const TZ = "Europe/London";

/** YYYY-MM-DD em Londres de um instante. */
export function dataEmLondres(iso: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(typeof iso === "string" ? new Date(iso) : iso);
}

type LinhaJob = {
  id: string;
  status: string;
  partner_id: string | null;
  catalog_service_id: string | null;
  scheduled_date: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  partner_cost: number | null;
};

export function paraJobDeEscala(j: LinhaJob): JobParaEscala {
  const data = j.scheduled_date?.slice(0, 10) || (j.scheduled_start_at ? dataEmLondres(j.scheduled_start_at) : null);
  return {
    id: j.id,
    status: j.status,
    partner_id: j.partner_id,
    catalog_service_id: j.catalog_service_id,
    data,
    startAt: j.scheduled_start_at,
    endAt: j.scheduled_end_at,
    partner_cost: j.partner_cost,
  };
}

export async function carregarCatalogo(sb: SupabaseClient): Promise<Catalogo> {
  const { data, error } = await sb.from("service_catalog").select("id, category_id").is("deleted_at", null);
  if (error) throw new Error(`catálogo: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.id as string, { category_id: (r.category_id as string | null) ?? null }]));
}

export async function carregarParceirosAtivos(sb: SupabaseClient): Promise<ParceiroParaEscala[]> {
  const { data, error } = await sb.from("partners").select("id, status, catalog_service_ids, availability, job_preferences").eq("status", "active");
  if (error) throw new Error(`parceiros: ${error.message}`);
  return (data ?? []) as ParceiroParaEscala[];
}

/**
 * Jobs que pesam na conta: os do período (vaga do dia) e os ativos de
 * qualquer data (máx. de jobs ativos). Sem cancelado nem apagado.
 */
export async function carregarJobs(sb: SupabaseClient, de: string, ate: string): Promise<JobParaEscala[]> {
  const campos = "id, status, partner_id, catalog_service_id, scheduled_date, scheduled_start_at, scheduled_end_at, partner_cost";
  const [periodo, ativos] = await Promise.all([
    sb.from("jobs").select(campos).gte("scheduled_date", de).lte("scheduled_date", ate).not("status", "in", "(cancelled,deleted)").is("deleted_at", null).limit(5000),
    sb.from("jobs").select(campos).in("status", ["unassigned", "auto_assigning", "scheduled", "late", "in_progress", "on_hold", "need_attention"]).is("deleted_at", null).not("partner_id", "is", null).limit(5000),
  ]);
  if (periodo.error) throw new Error(`jobs: ${periodo.error.message}`);
  const porId = new Map<string, LinhaJob>();
  for (const j of [...(periodo.data ?? []), ...(ativos.data ?? [])] as LinhaJob[]) porId.set(j.id, j);
  return [...porId.values()].map(paraJobDeEscala);
}

function datasEntre(de: string, ate: string): string[] {
  const out: string[] = [];
  const d = new Date(`${de}T12:00:00Z`);
  const fim = new Date(`${ate}T12:00:00Z`);
  while (d <= fim && out.length < 60) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export type VagasDoDia = { data: string; categorias: Record<string, { vagas: number; parceiros: number; semParceiro: number }> };

/** Vagas por dia e categoria no período. `categoryIds` vazio = todas. */
export async function vagasPorDia(sb: SupabaseClient, de: string, ate: string, categoryIds: string[] = []): Promise<VagasDoDia[]> {
  const [catalogo, parceiros, jobs] = await Promise.all([carregarCatalogo(sb), carregarParceirosAtivos(sb), carregarJobs(sb, de, ate)]);
  const cats = categoryIds.length ? categoryIds : [...new Set([...catalogo.values()].map((c) => c.category_id).filter(Boolean) as string[])];
  return datasEntre(de, ate).map((data) => ({
    data,
    categorias: Object.fromEntries(cats.map((c) => [c, vagasNaCategoria(c, data, parceiros, jobs, catalogo)])),
  }));
}

export type Elegibilidade = {
  degrau: "servico" | "categoria";
  elegiveis: ParceiroParaEscala[];
  excluidos: Array<{ id: string; motivo: string }>;
};

/** Quem pode receber o job, e por que cada um ficou de fora. */
export async function elegiveisParaJob(
  sb: SupabaseClient,
  job: JobParaEscala,
  degrau: "servico" | "categoria" = "servico",
  base?: { catalogo: Catalogo; parceiros: ParceiroParaEscala[]; jobs: JobParaEscala[] },
): Promise<Elegibilidade> {
  const data = job.data ?? dataEmLondres(new Date());
  const b = base ?? {
    catalogo: await carregarCatalogo(sb),
    parceiros: await carregarParceirosAtivos(sb),
    jobs: await carregarJobs(sb, data, data),
  };
  const outros = b.jobs.filter((j) => !job.id || j.id !== job.id);
  const elegiveis: ParceiroParaEscala[] = [];
  const excluidos: Array<{ id: string; motivo: string }> = [];
  for (const p of b.parceiros) {
    const a: Avaliacao = avaliarParceiro(p, job, outros, b.catalogo, degrau);
    if (a.ok) elegiveis.push(p);
    else excluidos.push({ id: p.id, motivo: a.motivo });
  }
  return { degrau, elegiveis, excluidos };
}
