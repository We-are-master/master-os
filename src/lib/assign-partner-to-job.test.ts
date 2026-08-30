import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildPartnerAssignPatch } from "./assign-partner-to-job";
import type { Job } from "@/types/database";

/** Job cru da coluna Unassigned: sem parceiro, sem extras, com depósito zerado. */
const baseJob = {
  id: "job-1",
  reference: "JOB-9999",
  status: "unassigned",
  job_type: "fixed",
  client_price: 0,
  partner_cost: 0,
  extras_amount: 0,
  partner_extras_amount: 0,
  materials_cost: 0,
  customer_deposit: 0,
  partner_id: null,
  partner_ids: [],
} as unknown as Job;

const INPUT = { partnerId: "p-1", partnerName: "G&M Services", partnerCost: 150, clientPrice: 280 };

test("assign de job fixo grava preço, custo e o que o cliente ainda deve", () => {
  const patch = buildPartnerAssignPatch(baseJob, INPUT);
  assert.equal(patch.partner_id, "p-1");
  assert.equal(patch.partner_name, "G&M Services");
  assert.deepEqual(patch.partner_ids, ["p-1"]);
  assert.equal(patch.client_price, 280);
  assert.equal(patch.partner_cost, 150);
  assert.equal(patch.customer_final_payment, 280);
  // unassigned vira scheduled assim que alguém é escalado.
  assert.equal(patch.status, "scheduled");
});

test("extras que já estavam no job não somem no assign", () => {
  // O parceiro já tinha £40 de extras (CCZ/parking) e £25 de material acordados.
  // Se o board gravasse só o custo digitado, esses £65 evaporavam do self-bill.
  const job = { ...baseJob, partner_extras_amount: 40, materials_cost: 25 } as Job;
  const patch = buildPartnerAssignPatch(job, INPUT);
  assert.equal(patch.partner_cost, 190); // 150 de labour + 40 de extras
  assert.equal(patch.partner_agreed_value, 215); // + 25 de material
});

test("depósito e extras do cliente saem do valor final a receber", () => {
  const job = { ...baseJob, customer_deposit: 100, extras_amount: 30 } as Job;
  const patch = buildPartnerAssignPatch(job, INPUT);
  // 280 de labour + 30 de extras − 100 já pagos = 210.
  assert.equal(patch.customer_final_payment, 210);
});

test("job por hora não tem o preço reescrito pelo board", () => {
  // O preço de job hourly vem do catálogo. O board escala o parceiro e não
  // encosta em rate nem em horas: mexer aqui quebrava a fatura do cliente.
  const job = {
    ...baseJob,
    job_type: "hourly",
    client_price: 340,
    partner_cost: 200,
    hourly_client_rate: 85,
    hourly_partner_rate: 50,
    billed_hours: 4,
  } as Job;
  const patch = buildPartnerAssignPatch(job, INPUT);
  assert.equal(patch.partner_id, "p-1");
  assert.equal(patch.client_price, undefined);
  assert.equal(patch.partner_cost, undefined);
  assert.equal(patch.hourly_partner_rate, undefined);
  assert.equal(patch.billed_hours, undefined);
});

test("job on hold volta pra scheduled e limpa o motivo da pausa", () => {
  const job = { ...baseJob, status: "on_hold", on_hold_reason: "Client away" } as unknown as Job;
  const patch = buildPartnerAssignPatch(job, INPUT);
  assert.equal(patch.status, "scheduled");
  assert.equal(patch.on_hold_reason, null);
  assert.equal(patch.on_hold_at, null);
});

test("job já em andamento não é jogado de volta pra scheduled", () => {
  // Trocar o parceiro de um job in_progress não pode apagar que o trabalho começou.
  const job = { ...baseJob, status: "in_progress", partner_id: "p-0" } as unknown as Job;
  const patch = buildPartnerAssignPatch(job, INPUT);
  assert.equal(patch.status, undefined);
});

test("assign com valor zero grava zero, nao ignora o campo", () => {
  // Visita de retorno: o trabalho já foi pago, nada novo entra nem sai. O board
  // precisa conseguir escalar alguém assim mesmo.
  const patch = buildPartnerAssignPatch(baseJob, {
    partnerId: "p-1",
    partnerName: "G&M Services",
    partnerCost: 0,
    clientPrice: 0,
  });
  assert.equal(patch.partner_id, "p-1");
  assert.equal(patch.client_price, 0);
  assert.equal(patch.partner_cost, 0);
  assert.equal(patch.customer_final_payment, 0);
  assert.equal(patch.status, "scheduled");
});

test("retorno com zero nao apaga extras ja acordados", () => {
  const job = { ...baseJob, partner_extras_amount: 40, materials_cost: 25 } as Job;
  const patch = buildPartnerAssignPatch(job, {
    partnerId: "p-1",
    partnerName: "G&M Services",
    partnerCost: 0,
    clientPrice: 0,
  });
  assert.equal(patch.partner_cost, 40);
  assert.equal(patch.partner_agreed_value, 65);
});

/**
 * O rótulo do acordo (mig 281). Day rate e Half day são o MESMO fixed por
 * baixo: mudam só a linha que o parceiro lê no email, nunca o dinheiro.
 */
test("grava o acordo escolhido no assign", () => {
  const patch = buildPartnerAssignPatch(baseJob, { ...INPUT, rateBasis: "daily" });
  assert.equal(patch.rate_basis, "daily");
  assert.equal(patch.partner_cost, 150, "o rótulo não pode mexer no dinheiro");
  assert.equal(patch.client_price, 280);
});

test("half day tambem e fixed por baixo", () => {
  const patch = buildPartnerAssignPatch(baseJob, { ...INPUT, rateBasis: "half_day" });
  assert.equal(patch.rate_basis, "half_day");
  assert.equal(patch.job_type, "fixed");
});

/** Tela que não pergunta não pode apagar o acordo que já estava no job. */
test("sem rateBasis no input, o acordo do job fica como estava", () => {
  const comAcordo = { ...baseJob, rate_basis: "daily" } as unknown as Job;
  const patch = buildPartnerAssignPatch(comAcordo, INPUT);
  assert.equal(patch.rate_basis, undefined, "não pode sobrescrever com null");
});

test("hourly nao ganha rotulo de fixo", () => {
  const porHora = { ...baseJob, job_type: "hourly", hourly_partner_rate: 25 } as unknown as Job;
  const patch = buildPartnerAssignPatch(porHora, INPUT);
  assert.equal(patch.rate_basis, undefined);
  assert.equal(patch.client_price, undefined, "hourly não mexe em preço no assign");
});
