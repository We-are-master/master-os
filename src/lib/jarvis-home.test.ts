import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFrontendSetup } from "./frontend-setup";
import { calcularDadosDaMeta, saudeDoMes, type DadosDaMeta } from "./pulse-month-goal";
import { separarAcoes } from "./pulse-action-required";
import { montarBlocoHome } from "./jarvis-home";
import type { PulseCeo } from "./pulse-ceo";

const DADOS: DadosDaMeta = {
  receita: 5000,
  custo: 1800,
  lucro: 3000,
  estimados: 1,
  entregue: 2500,
  jobs: 4,
  jobsEntregues: 2,
  meta: 30000,
  fixos: 3500,
  empate: null,
  margemAlvo: 40,
};

const FUNIL: PulseCeo["funil"] = {
  leads: 70,
  porCanal: [],
  quotes: 22,
  fechados: { n: 20, valor: 9000 },
  entregues: { n: 22, valor: 8000 },
  pagos: { n: 0, valor: 0 },
  conversao: 0,
  convertidos: 0,
};

describe("calcularDadosDaMeta (home: Revenue e Net profit)", () => {
  const setup = parseFrontendSetup({ target_margin_pct: 40, pulse_revenue_goal_mode: "manual", pulse_revenue_goal_monthly_gbp: 30000 });
  const linhas = [
    { status: "completed", client_price: 1000, extras_amount: 0, partner_cost: 500, materials_cost: 100 },
    // Sem custo e não entregue: entra pela margem alvo (40% de 500).
    { status: "unassigned", client_price: 450, extras_amount: 50, partner_cost: null, materials_cost: null },
    { status: "cancelled", client_price: 9999, extras_amount: 0, partner_cost: 0, materials_cost: 0 },
  ];
  const d = calcularDadosDaMeta({ linhas, setup, folha: [{ amount: 2000, lifecycle_stage: "active" }], bills: [] });

  it("cancelado fica fora da receita e dos jobs", () => {
    assert.equal(d.receita, 1500);
    assert.equal(d.jobs, 2);
  });
  it("job sem custo entra pela margem alvo", () => {
    assert.equal(d.lucro, 400 + 200);
    assert.equal(d.estimados, 1);
    assert.equal(d.custo, 600);
  });
  it("meta e fixos vêm do setup e da folha", () => {
    assert.equal(d.meta, 30000);
    assert.equal(d.fixos, 2000);
    assert.equal(d.jobsEntregues, 1);
  });
});

describe("saudeDoMes", () => {
  it("linha reta até hoje: 14/11 de 30 dias", () => {
    const s = saudeDoMes(DADOS, "2026-11-14");
    assert.equal(s.diasRestantes, 17);
    assert.equal(s.esperadoHoje, 14000);
    assert.equal(s.atras, 9000);
    assert.equal(s.resultado, -500);
    assert.equal(s.faltaEmpate, 500);
    assert.equal(s.custoJobs, 2000);
    assert.equal(s.ticketMedio, 1250);
    assert.equal(s.sinalVendas, "bad");
  });
  it("sem meta, sem sinal de vendas", () => {
    assert.equal(saudeDoMes({ ...DADOS, meta: null }, "2026-11-14").sinalVendas, null);
  });
});

describe("separarAcoes (Action required)", () => {
  it("final review soma o valor; sem parceiro conta unassigned e auto_assigning", () => {
    const a = separarAcoes([
      { status: "final_check", client_price: 100, extras_amount: 20 },
      { status: "final_check", client_price: 80, extras_amount: null },
      { status: "unassigned", client_price: 50, extras_amount: 0 },
      { status: "auto_assigning", client_price: 50, extras_amount: 0 },
      { status: "scheduled", client_price: 50, extras_amount: 0 },
      { status: "late", client_price: 50, extras_amount: 0 },
      { status: "in_progress", client_price: 50, extras_amount: 0 },
    ]);
    assert.equal(a.revisao.length, 2);
    assert.equal(a.valorDaRevisao, 200);
    assert.equal(a.semParceiro.length, 2);
    assert.equal(a.agendados, 2);
    assert.equal(a.emAndamento, 1);
  });
});

describe("montarBlocoHome", () => {
  const base = {
    hoje: "2026-11-14",
    dados: DADOS,
    funil: FUNIL,
    vencidoDoTopo: { n: 5, valor: 2343.21 },
    jobsDasAcoes: [
      { status: "final_check", client_price: 300, extras_amount: 0 },
      { status: "unassigned", client_price: 100, extras_amount: 0 },
    ],
    faturasVencidas: [{ balance: 2000 }, { balance: 343.21 }],
    fx: { rate: 7.4, source: "wise" as const, fetchedAt: "2026-11-14T12:00:00Z" },
  };

  it("os números do topo batem com a home", () => {
    const h = montarBlocoHome(base);
    assert.equal(h.mes, "2026-11");
    assert.equal(h.dias_restantes, 17);
    assert.equal(h.receita, 5000);
    assert.equal(h.meta, 30000);
    assert.equal(h.meta_pct, 17);
    assert.equal(h.abaixo_da_meta, 9000);
    assert.equal(h.status_meta, "below");
    assert.equal(h.lucro_bruto, 3000);
    assert.equal(h.margem_bruta_pct, 60);
    assert.equal(h.custos_fixos, 3500);
    assert.equal(h.custo_operacao, 2000);
    assert.equal(h.lucro_liquido, -500);
    assert.equal(h.falta_break_even, 500);
    assert.equal(h.jobs, 4);
    assert.equal(h.ticket_medio, 1250);
    assert.deepEqual(h.vencido, { valor: 2343.21, faturas: 5 });
    assert.deepEqual(h.fx, { gbp_brl: 7.4, fonte: "wise" });
  });

  it("funil com as taxas da tela (31% dos leads, 110% dos booked)", () => {
    assert.deepEqual(montarBlocoHome(base).funil, {
      leads: 70,
      quotes: 22,
      quotes_pct: 31,
      booked: 20,
      entregues: 22,
      entregues_pct: 110,
      vendas: 9000,
    });
  });

  it("cartões de ação", () => {
    assert.deepEqual(montarBlocoHome(base).acoes, {
      final_review: { n: 1, valor_a_faturar: 300 },
      faturas_vencidas: { n: 2, valor: 2343.21 },
      sem_parceiro: 1,
    });
  });

  it("status da meta: unset, on_track e above", () => {
    assert.equal(montarBlocoHome({ ...base, dados: { ...DADOS, meta: null } }).status_meta, "unset");
    assert.equal(montarBlocoHome({ ...base, dados: { ...DADOS, receita: 15000 } }).status_meta, "on_track");
    assert.equal(montarBlocoHome({ ...base, dados: { ...DADOS, receita: 31000 } }).status_meta, "above");
  });

  it("sem lead, sem taxa; sem câmbio, fx null", () => {
    const h = montarBlocoHome({ ...base, funil: { ...FUNIL, leads: 0 }, fx: null });
    assert.equal(h.funil.quotes_pct, null);
    assert.equal(h.fx, null);
  });
});
