/**
 * O bloco `home` do resumo do JARVIS: exatamente os números da home do OS (Overview,
 * "Good afternoon, ..."), mês corrente de Londres, em GBP.
 *
 * Nada de conta nova aqui. Cada número sai da mesma função que a tela usa:
 *  - Revenue e Net profit: `buscarDadosDaMeta` + `saudeDoMes` (`@/lib/pulse-month-goal`),
 *    os mesmos do MonthHealth.
 *  - Faixa do topo (overdue): `montarReceberDoPeriodo(sb, null, null)`, o mesmo de /api/pulse/receber.
 *  - Funil: `montarPulseCeo(...).funil`, o mesmo de /api/pulse/ceo (a home sem filtro de data).
 *  - Action required: `buscarJobsDasAcoes` + `separarAcoes` (`@/lib/pulse-action-required`)
 *    e `listarFaturasVencidas` (`@/lib/invoice-overdue-list`), o mesmo de /api/invoices/overdue.
 *  - Câmbio: `cotacaoGbpBrl` (`@/lib/fx-gbp-brl`), o mesmo de /api/fx/gbp-brl.
 *
 * É sempre o estado de agora: a home não tem dia passado, então o `?dia=` do resumo não muda este bloco.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarDadosDaMeta, saudeDoMes, type DadosDaMeta } from "@/lib/pulse-month-goal";
import { buscarJobsDasAcoes, separarAcoes } from "@/lib/pulse-action-required";
import { listarFaturasVencidas, type FaturaVencida } from "@/lib/invoice-overdue-list";
import { montarPulseCeo, montarReceberDoPeriodo, type PulseCeo } from "@/lib/pulse-ceo";
import { cotacaoGbpBrl, type CotacaoGbpBrl } from "@/lib/fx-gbp-brl";
import { ymdDeLondres } from "@/lib/placar-diario";

const r2 = (n: number) => Math.round(n * 100) / 100;
/** A home mostra a porcentagem arredondada; sem base, a tela não mostra a taxa. */
const pctDe = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);

export type StatusDaMeta = "above" | "on_track" | "below" | "unset";

export type HomeJarvis = {
  mes: string;
  dias_restantes: number;
  receita: number;
  meta: number | null;
  /** % da meta já faturado, como na barra ("18%"). Null sem meta. */
  meta_pct: number | null;
  abaixo_da_meta: number;
  status_meta: StatusDaMeta;
  lucro_bruto: number;
  margem_bruta_pct: number;
  custos_fixos: number;
  custo_operacao: number;
  lucro_liquido: number;
  falta_break_even: number;
  jobs: number;
  ticket_medio: number;
  vencido: { valor: number; faturas: number };
  funil: { leads: number; quotes: number; quotes_pct: number | null; booked: number; entregues: number; entregues_pct: number | null; vendas: number };
  acoes: { final_review: { n: number; valor_a_faturar: number }; faturas_vencidas: { n: number; valor: number }; sem_parceiro: number };
  fx: { gbp_brl: number; fonte: CotacaoGbpBrl["source"] } | null;
};

/** Sem banco: monta o bloco a partir do que as funções da home devolveram. */
export function montarBlocoHome(input: {
  hoje: string;
  dados: DadosDaMeta;
  funil: PulseCeo["funil"];
  vencidoDoTopo: { n: number; valor: number };
  jobsDasAcoes: Array<{ status: string; client_price: number | null; extras_amount: number | null }>;
  faturasVencidas: Pick<FaturaVencida, "balance">[];
  fx: CotacaoGbpBrl | null;
}): HomeJarvis {
  const s = saudeDoMes(input.dados, input.hoje);
  // Mesma régua do card Revenue: verde ("On target") quando a receita alcançou a linha reta
  // até hoje; "above" quando já passou da meta do mês inteiro.
  const status_meta: StatusDaMeta = !s.meta ? "unset" : s.receita >= s.meta ? "above" : s.atras <= 0 ? "on_track" : "below";
  const acoes = separarAcoes(input.jobsDasAcoes);
  const f = input.funil;
  return {
    mes: input.hoje.slice(0, 7),
    dias_restantes: s.diasRestantes,
    receita: r2(s.receita),
    meta: s.meta == null ? null : r2(s.meta),
    meta_pct: s.meta ? Math.round(s.pct) : null,
    abaixo_da_meta: s.meta ? r2(Math.max(0, s.atras)) : 0,
    status_meta,
    lucro_bruto: r2(s.bruto),
    margem_bruta_pct: Math.round(s.margem),
    custos_fixos: r2(s.fixos),
    custo_operacao: r2(s.custoJobs),
    lucro_liquido: r2(s.resultado),
    falta_break_even: r2(s.faltaEmpate),
    jobs: input.dados.jobs,
    ticket_medio: r2(s.ticketMedio),
    vencido: { valor: r2(input.vencidoDoTopo.valor), faturas: input.vencidoDoTopo.n },
    funil: {
      leads: f.leads,
      quotes: f.quotes,
      quotes_pct: pctDe(f.quotes, f.leads),
      booked: f.fechados.n,
      entregues: f.entregues.n,
      entregues_pct: pctDe(f.entregues.n, f.fechados.n),
      vendas: r2(f.fechados.valor),
    },
    acoes: {
      final_review: { n: acoes.revisao.length, valor_a_faturar: r2(acoes.valorDaRevisao) },
      faturas_vencidas: { n: input.faturasVencidas.length, valor: r2(input.faturasVencidas.reduce((t, x) => t + x.balance, 0)) },
      sem_parceiro: acoes.semParceiro.length,
    },
    fx: input.fx ? { gbp_brl: input.fx.rate, fonte: input.fx.source } : null,
  };
}

export async function buscarHomeJarvis(sb: SupabaseClient, agora = new Date()): Promise<HomeJarvis> {
  const hoje = ymdDeLondres(agora);
  const [dados, ceo, receber, jobs, vencidas, fx] = await Promise.all([
    buscarDadosDaMeta(sb, hoje, agora),
    montarPulseCeo(sb, agora),
    montarReceberDoPeriodo(sb, null, null, agora),
    buscarJobsDasAcoes(sb),
    listarFaturasVencidas(sb, hoje),
    cotacaoGbpBrl().catch(() => null),
  ]);
  if (jobs.error) throw jobs.error;
  return montarBlocoHome({
    hoje,
    dados,
    funil: ceo.funil,
    vencidoDoTopo: receber.vencido,
    jobsDasAcoes: (jobs.data ?? []) as Array<{ status: string; client_price: number | null; extras_amount: number | null }>,
    faturasVencidas: vencidas,
    fx,
  });
}
