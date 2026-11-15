/**
 * Os números do mês corrente de Londres que a home (Overview) mostra no topo: meta,
 * faturamento, custo, lucro bruto, fixos e o resultado. Mora aqui, fora do componente,
 * para o JARVIS (`/api/jarvis/resumo`) dizer exatamente o que a tela mostra.
 *
 *  - Faturamento do mês = todo job com visita no mês que não foi cancelado, incluindo os
 *    abertos (sem parceiro, agendado, em andamento, em espera, final check). Job com
 *    horário marcado entra pelo horário; job só com o dia entra pelo dia.
 *  - Custo anda junto com a venda: repasse e material dos MESMOS jobs. Job ainda sem custo
 *    e não entregue entra pela margem alvo (senão contaria 100% de lucro).
 *  - Fixos = folha ativa + bills recorrentes por mês, o mesmo Breakeven de Settings.
 *  - A meta é a de Settings > Setup ("Pulse · Revenue goal").
 *
 * `buscarDadosDaMeta` aceita qualquer cliente Supabase: a tela passa o do navegador, o
 * JARVIS passa o de serviço. As contas ficam em `calcularDadosDaMeta` e `saudeDoMes`,
 * puras e testadas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseFrontendSetup, type FrontendSetup } from "@/lib/frontend-setup";
import { computeMonthlyBillsBurn, computeWorkforceMonthlyBurn, type PulseBillRow } from "@/lib/pulse-fixed-costs";
import { computeBreakevenMonthly, resolvePulseMonthlyRevenueGoal } from "@/lib/pulse-revenue-goal";
import { WORKFORCE_COST_ACTIVE_OR_FILTER } from "@/lib/workforce-lifecycle";
import { ukWallClockToUtcIso } from "@/lib/utils/uk-time";

const FORA = new Set(["cancelled", "deleted"]);
const ENTREGUE = new Set(["final_check", "awaiting_payment", "completed"]);

export type LinhaDaMeta = {
  status: string;
  client_price: number | null;
  extras_amount: number | null;
  partner_cost: number | null;
  materials_cost: number | null;
};

export type DadosDaMeta = {
  receita: number;
  custo: number;
  lucro: number;
  estimados: number;
  entregue: number;
  jobs: number;
  jobsEntregues: number;
  meta: number | null;
  fixos: number;
  empate: number | null;
  margemAlvo: number;
};

/** Sem banco: as linhas dos jobs do mês, o setup, a folha e as bills. */
export function calcularDadosDaMeta(input: {
  linhas: LinhaDaMeta[];
  setup: FrontendSetup;
  folha: Array<{ amount: number | null; lifecycle_stage: string | null }>;
  bills: PulseBillRow[];
  agora?: Date;
}): DadosDaMeta {
  const linhas = input.linhas.filter((j) => !FORA.has(j.status));
  const v = (j: LinhaDaMeta) => (Number(j.client_price) || 0) + (Number(j.extras_amount) || 0);
  const c = (j: LinhaDaMeta) => (Number(j.partner_cost) || 0) + (Number(j.materials_cost) || 0);
  const entregues = linhas.filter((j) => ENTREGUE.has(j.status));
  const fixos = computeWorkforceMonthlyBurn(input.folha) + computeMonthlyBillsBurn(input.bills, input.agora ?? new Date());
  const margemAlvo = input.setup.target_margin_pct ?? 0;
  const semCusto = (j: LinhaDaMeta) => c(j) === 0 && !ENTREGUE.has(j.status);
  return {
    lucro: linhas.reduce((t, j) => t + (semCusto(j) ? (v(j) * margemAlvo) / 100 : v(j) - c(j)), 0),
    estimados: linhas.filter(semCusto).length,
    receita: linhas.reduce((t, j) => t + v(j), 0),
    custo: linhas.reduce((t, j) => t + c(j), 0),
    entregue: entregues.reduce((t, j) => t + v(j), 0),
    jobs: linhas.length,
    jobsEntregues: entregues.length,
    meta: resolvePulseMonthlyRevenueGoal(input.setup, 0).monthlyGoal,
    fixos,
    empate: computeBreakevenMonthly(fixos, margemAlvo),
    margemAlvo,
  };
}

/** Busca e calcula o mês de `hoje` (YYYY-MM-DD de Londres). */
export async function buscarDadosDaMeta(sb: SupabaseClient, hoje: string, agora = new Date()): Promise<DadosDaMeta> {
  const inicio = `${hoje.slice(0, 8)}01`;
  const [ano, mes] = hoje.split("-").map(Number);
  const proximo = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;
  const deIso = ukWallClockToUtcIso(inicio, "00:00");
  const ateIso = ukWallClockToUtcIso(proximo, "00:00");
  const cols = "status, client_price, extras_amount, partner_cost, materials_cost";
  const [comHora, soDia, cfg, folha, bills] = await Promise.all([
    deIso && ateIso
      ? sb.from("jobs").select(cols).is("deleted_at", null).gte("scheduled_start_at", deIso).lt("scheduled_start_at", ateIso).limit(5000)
      : Promise.resolve({ data: [] as LinhaDaMeta[] }),
    sb.from("jobs").select(cols).is("deleted_at", null).is("scheduled_start_at", null).gte("scheduled_date", inicio).lt("scheduled_date", proximo).limit(5000),
    sb.from("company_settings").select("frontend_setup").limit(1).maybeSingle(),
    sb.from("payroll_internal_costs").select("amount, lifecycle_stage").or(WORKFORCE_COST_ACTIVE_OR_FILTER),
    sb
      .from("bills")
      .select("id, amount, is_recurring, recurrence_interval, recurring_series_id, recurring_series_end_date, status, due_date, description, category")
      .is("archived_at", null)
      .neq("status", "rejected"),
  ]);
  return calcularDadosDaMeta({
    linhas: [...((comHora.data ?? []) as LinhaDaMeta[]), ...((soDia.data ?? []) as LinhaDaMeta[])],
    setup: parseFrontendSetup((cfg.data as { frontend_setup?: unknown } | null)?.frontend_setup),
    folha: (folha.data ?? []) as Array<{ amount: number | null; lifecycle_stage: string | null }>,
    bills: (bills.data ?? []) as PulseBillRow[],
    agora,
  });
}

export type SinalDaSaude = "ok" | "watch" | "bad";

/**
 * As contas do card Revenue e do card Net profit da home, sobre os dados do mês.
 * Sem banco: testável. `hoje` é o dia de Londres (YYYY-MM-DD).
 */
export function saudeDoMes(d: DadosDaMeta, hoje: string) {
  const [ano, mes, dia] = hoje.split("-").map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const diasRestantes = Math.max(1, ultimoDia - dia + 1);

  // 1. Vendas
  const meta = d.meta ?? null;
  const receita = d.receita;
  const pct = meta ? Math.min(100, (receita / meta) * 100) : 0;
  const esperadoHoje = meta ? (meta * dia) / ultimoDia : 0;
  const atras = meta ? esperadoHoje - receita : 0;
  const ticketMedio = d.jobs > 0 ? receita / d.jobs : 0;
  const sinalVendas: SinalDaSaude | null = !meta ? null : atras <= 0 ? "ok" : atras <= esperadoHoje * 0.15 ? "watch" : "bad";

  // 2. Lucro: receita, menos custo dos jobs (lucro bruto), menos fixos.
  const bruto = d.lucro;
  const custoJobs = receita - bruto;
  const margem = receita > 0 ? (bruto / receita) * 100 : 0;
  const fixos = d.fixos;
  const resultado = bruto - fixos;
  // Ritmo, não o mês inteiro: compara o lucro bruto com a fração dos fixos que já correu.
  const fixosAteHoje = (fixos * dia) / ultimoDia;
  const sinalLucro: SinalDaSaude = resultado >= 0 || bruto >= fixosAteHoje ? "ok" : bruto >= fixosAteHoje * 0.8 ? "watch" : "bad";
  const faltaEmpate = Math.max(0, fixos - bruto);

  return {
    dia,
    ultimoDia,
    diasRestantes,
    meta,
    receita,
    pct,
    esperadoHoje,
    atras,
    ticketMedio,
    sinalVendas,
    bruto,
    custoJobs,
    margem,
    fixos,
    resultado,
    fixosAteHoje,
    sinalLucro,
    faltaEmpate,
  };
}
