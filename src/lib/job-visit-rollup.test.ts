import test from "node:test";
import assert from "node:assert/strict";
import type { Job, JobVisit } from "@/types/database";
import {
  jobBillableRevenue,
  jobDirectCost,
  jobMarginPercent,
  partnerPaymentCap,
} from "./job-financials";
import { jobStatusRank } from "./job-phases";
import {
  canAddAnotherVisit,
  jobHasExtraVisits,
  jobTotalBillableRevenue,
  jobTotalDirectCost,
  jobTotalMarginPercent,
  partnerCapForScope,
  rollUpJobVisits,
  rollupFromStoredColumns,
  visitCountsForMoney,
  visitPaymentCap,
} from "./job-visit-rollup";

function job(over: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    reference: "JOB-9391",
    client_price: 1250,
    extras_amount: 0,
    partner_cost: 300,
    materials_cost: 0,
    partner_agreed_value: 0,
    partner_id: "p-ats",
    partner_name: "ATS Maintenance",
    scheduled_date: "2026-08-05",
    scheduled_start_at: "2026-08-05T13:00:00Z",
    ...over,
  } as unknown as Job;
}

function visit(over: Partial<JobVisit> = {}): JobVisit {
  return {
    id: "v-2",
    job_id: "job-1",
    visit_index: 2,
    partner_id: "p-gm",
    partner_name: "G&M Services",
    client_price: 420,
    partner_cost: 210,
    materials_cost: 0,
    status: "completed",
    created_at: "2026-08-12T00:00:00Z",
    updated_at: "2026-08-12T00:00:00Z",
    ...over,
  } as JobVisit;
}

// ---------------------------------------------------------------- o portão
// Aceite da etapa 0: em job sem visita, o rollup devolve exatamente o que as
// funções de hoje devolvem. Se este teste quebrar, a adoção do rollup mudou
// número em job de uma visita só — que é a esmagadora maioria da base.

test("job sem visita: rollup é idêntico ao cálculo de hoje", () => {
  const j = job({ extras_amount: 80, materials_cost: 25 });
  const r = rollUpJobVisits(j, []);

  assert.equal(r.visitCount, 1);
  assert.equal(jobTotalBillableRevenue(j, r), jobBillableRevenue(j));
  assert.equal(jobTotalDirectCost(r), jobDirectCost(j));
  assert.equal(jobTotalMarginPercent(j, r), jobMarginPercent(j));
  assert.equal(partnerCapForScope(j, null), partnerPaymentCap(j));
  assert.equal(jobHasExtraVisits(r), false);
});

test("job sem visita: lista vazia, nula e indefinida dão o mesmo", () => {
  const j = job();
  const base = rollUpJobVisits(j, []);
  assert.deepEqual(rollUpJobVisits(j, null), base);
  assert.deepEqual(rollUpJobVisits(j, undefined), base);
});

// ------------------------------------------------------------- somatórios

test("visitas somam por cima do job, sem tocar na visita 1", () => {
  const j = job();
  const r = rollUpJobVisits(j, [visit(), visit({ id: "v-3", visit_index: 3, client_price: 140, partner_cost: 70 })]);

  assert.equal(r.visitCount, 3);
  assert.equal(r.clientPriceTotal, 1810);
  assert.equal(r.partnerCostTotal, 580);
  assert.equal(jobHasExtraVisits(r), true);
  // a linha da visita 1 continua com o dinheiro do job, não com o total
  assert.equal(r.perVisit[0].clientPrice, 1250);
  assert.equal(r.perVisit[0].visitId, null);
});

test("perVisit sai ordenado por índice mesmo com a lista fora de ordem", () => {
  const r = rollUpJobVisits(job(), [
    visit({ id: "v-4", visit_index: 4 }),
    visit({ id: "v-2", visit_index: 2 }),
    visit({ id: "v-3", visit_index: 3 }),
  ]);
  assert.deepEqual(r.perVisit.map((l) => l.visitIndex), [1, 2, 3, 4]);
});

test("visita cancelada e visita deletada não contam como dinheiro", () => {
  const j = job();
  const cancelled = visit({ id: "v-c", visit_index: 2, status: "cancelled", client_price: 999, partner_cost: 999 });
  const deleted = visit({ id: "v-d", visit_index: 3, deleted_at: "2026-08-20T00:00:00Z", client_price: 999 });

  assert.equal(visitCountsForMoney(cancelled), false);
  assert.equal(visitCountsForMoney(deleted), false);

  const r = rollUpJobVisits(j, [cancelled, deleted]);
  assert.equal(r.visitCount, 1);
  assert.equal(r.clientPriceTotal, 1250);
  assert.equal(r.partnerCostTotal, 300);
});

test("extras continuam no nível do job e entram uma vez só na receita", () => {
  const j = job({ extras_amount: 110 });
  const r = rollUpJobVisits(j, [visit()]);
  assert.equal(jobTotalBillableRevenue(j, r), 1250 + 420 + 110);
});

test("margem usa o total das visitas dos dois lados", () => {
  const j = job({ extras_amount: 0, materials_cost: 0 });
  const r = rollUpJobVisits(j, [visit()]);
  // (1670 - 510) / 1670
  assert.equal(jobTotalDirectCost(r), 510);
  assert.equal(jobTotalMarginPercent(j, r), 69.5);
});

test("receita zero não vira divisão por zero", () => {
  const j = job({ client_price: 0, extras_amount: 0, partner_cost: 0 });
  assert.equal(jobTotalMarginPercent(j, rollUpJobVisits(j, [])), 0);
});

// ------------------------------------------------------- colunas guardadas

test("rollupFromStoredColumns lê as colunas do trigger", () => {
  const j = job({ visits_count: 3, total_client_price: 1810, total_partner_cost: 580, total_materials_cost: 25 });
  const r = rollupFromStoredColumns(j);
  assert.equal(r.visitCount, 3);
  assert.equal(r.clientPriceTotal, 1810);
  assert.equal(r.partnerCostTotal, 580);
  assert.equal(r.materialsCostTotal, 25);
});

test("banco sem a migração cai na visita 1 em vez de zerar o job", () => {
  const j = job({ materials_cost: 25 });
  const r = rollupFromStoredColumns(j);
  assert.equal(r.visitCount, 1);
  assert.equal(r.clientPriceTotal, 1250);
  assert.equal(r.partnerCostTotal, 300);
  assert.equal(r.materialsCostTotal, 25);
});

// ------------------------------------------------------------- teto do pagamento

test("teto por visita ignora o partner_agreed_value do job", () => {
  const j = job({ partner_agreed_value: 5000 });
  const v = visit({ partner_cost: 210 });
  assert.equal(visitPaymentCap(v), 210);
  assert.equal(partnerCapForScope(j, v), 210);
  // sem visita, o override do job continua mandando na visita 1
  assert.equal(partnerCapForScope(j, null), 5000);
});

// ------------------------------------------------------------------ o gate

test("visita 1 aberta bloqueia a proxima, e o motivo diz qual", () => {
  const g = canAddAnotherVisit(job({ status: "in_progress" }), [], jobStatusRank);
  assert.equal(g.allowed, false);
  assert.match(g.allowed === false ? g.reason : "", /visit 1/i);
});

test("visita 1 fechada libera a segunda", () => {
  for (const status of ["final_check", "awaiting_payment", "completed"] as const) {
    assert.equal(canAddAnotherVisit(job({ status }), [], jobStatusRank).allowed, true, status);
  }
});

test("ultima visita aberta bloqueia, e o motivo aponta o indice certo", () => {
  const j = job({ status: "completed" });
  const g = canAddAnotherVisit(j, [visit({ visit_index: 2, status: "completed" }), visit({ id: "v-3", visit_index: 3, status: "in_progress" })], jobStatusRank);
  assert.equal(g.allowed, false);
  assert.match(g.allowed === false ? g.reason : "", /visit 3/);
});

test("todas as visitas fechadas libera a proxima", () => {
  const j = job({ status: "completed" });
  const g = canAddAnotherVisit(j, [visit({ visit_index: 2, status: "completed" })], jobStatusRank);
  assert.equal(g.allowed, true);
});

test("visita cancelada nao segura a fila", () => {
  const j = job({ status: "completed" });
  const g = canAddAnotherVisit(j, [visit({ visit_index: 2, status: "cancelled" })], jobStatusRank);
  assert.equal(g.allowed, true);
});

test("job cancelado nao aceita visita nova", () => {
  assert.equal(canAddAnotherVisit(job({ status: "cancelled" }), [], jobStatusRank).allowed, false);
});
