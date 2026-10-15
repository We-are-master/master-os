import { test } from "node:test";
import assert from "node:assert/strict";
import { boolDoRelatorio, decidirFinalCheck, entraNaVarredura, problemasDoRelatorio, type EntradaFinalCheck } from "./final-check-decisao";

const base = (over: Partial<EntradaFinalCheck> = {}): EntradaFinalCheck => ({
  status: "final_check",
  reviewSentAt: null,
  finalReportSubmitted: true,
  jobType: "fixed",
  platformReport: false,
  reportFields: { description: "Replaced the tap and tested for leaks.", completion_status: "complete", follow_up_required: false },
  reportGate: { ok: true },
  materialExtraCharge: 0,
  complaint: false,
  jobTotal: 180,
  invoicesTotal: 180,
  customerPaid: 90,
  weeklyInvoice: false,
  emailPolicy: { canIncludeInvoice: true, canIncludeReport: true },
  billingEmail: "jane@example.com",
  ...over,
});

test("relatório limpo com saldo: aprova e cobra o saldo", () => {
  assert.deepEqual(decidirFinalCheck(base()), { acao: "aprovar", pagoTotal: false, saldo: 90 });
});

test("pago na reserva: aprova sem saldo", () => {
  assert.deepEqual(decidirFinalCheck(base({ customerPaid: 180 })), { acao: "aprovar", pagoTotal: true, saldo: 0 });
});

test("job ainda sem fatura: aprova (a fatura nasce na aprovação)", () => {
  assert.equal(decidirFinalCheck(base({ invoicesTotal: null })).acao, "aprovar");
});

test("fora de final check, já enviado ou sem relatório: ignora sem nota", () => {
  assert.equal(decidirFinalCheck(base({ status: "awaiting_payment" })).acao, "ignorar");
  assert.equal(decidirFinalCheck(base({ reviewSentAt: "2026-10-15T10:00:00Z" })).acao, "ignorar");
  assert.equal(decidirFinalCheck(base({ finalReportSubmitted: false })).acao, "ignorar");
});

const codigo = (d: ReturnType<typeof decidirFinalCheck>) => (d.acao === "equipe" ? d.codigo : d.acao);

test("reclamação fica para a equipe antes de tudo", () => {
  assert.equal(codigo(decidirFinalCheck(base({ complaint: true, customerPaid: 180 }))), "complaint");
});

test("relatório incompleto fica para a equipe", () => {
  assert.equal(codigo(decidirFinalCheck(base({ reportGate: { ok: false, message: "Report is not complete yet: photos." } }))), "report_incomplete");
});

test("relatório com problema marcado fica para a equipe", () => {
  for (const f of [
    { completion_status: "partially_complete" },
    { completion_status: "could_not_complete" },
    { what_needs_completing: "Second coat of paint" },
    { job_complete: false },
    { job_complete: "false" },
    { all_tasks_done: "no" },
    { follow_up_required: true },
    { remedial_work_required: "true" },
    { site_access_obtained: false },
    { certificate_outcome: "unsatisfactory" },
    { scope_changes: true },
    { pre_existing_damage: true },
    { additional_charges: true },
  ]) {
    assert.equal(codigo(decidirFinalCheck(base({ reportFields: f }))), "report_flags", JSON.stringify(f));
  }
});

test("nota do parceiro dizendo que não terminou fica para a equipe", () => {
  for (const d of ["Not finished, need parts", "Will come back tomorrow to finish", "Couldn't complete the bathroom", "work incomplete"]) {
    assert.equal(codigo(decidirFinalCheck(base({ reportFields: { description: d } }))), "partner_notes", d);
  }
  assert.equal(codigo(decidirFinalCheck(base({ reportFields: { description: "All done, finished and cleaned up." } }))), "aprovar");
});

test("material extra no relatório, por hora, plataforma e fatura semanal ficam para a equipe", () => {
  assert.equal(codigo(decidirFinalCheck(base({ materialExtraCharge: 26 }))), "material_extra");
  assert.equal(codigo(decidirFinalCheck(base({ jobType: "hourly" }))), "hourly");
  assert.equal(codigo(decidirFinalCheck(base({ platformReport: true }))), "platform");
  assert.equal(codigo(decidirFinalCheck(base({ weeklyInvoice: true }))), "weekly_invoice");
});

test("preço do job diferente da fatura fica para a equipe", () => {
  assert.equal(codigo(decidirFinalCheck(base({ jobTotal: 220, invoicesTotal: 180 }))), "price_mismatch");
  assert.equal(codigo(decidirFinalCheck(base({ jobTotal: 180.01, invoicesTotal: 180 }))), "aprovar");
  assert.equal(codigo(decidirFinalCheck(base({ jobTotal: 0, invoicesTotal: null }))), "no_price");
});

test("sem e-mail do cliente ou conta sem e-mail final fica para a equipe", () => {
  assert.equal(codigo(decidirFinalCheck(base({ billingEmail: null }))), "no_email");
  assert.equal(codigo(decidirFinalCheck(base({ billingEmail: "  " }))), "no_email");
  assert.equal(
    codigo(decidirFinalCheck(base({ emailPolicy: { canIncludeInvoice: false, canIncludeReport: false } }))),
    "email_off",
  );
  // Só relatório (sem fatura no e-mail) ainda aprova.
  assert.equal(codigo(decidirFinalCheck(base({ emailPolicy: { canIncludeInvoice: false, canIncludeReport: true } }))), "aprovar");
});

test("leitura dos booleanos e das notas do relatório", () => {
  assert.equal(boolDoRelatorio("Yes"), true);
  assert.equal(boolDoRelatorio("false"), false);
  assert.equal(boolDoRelatorio(""), null);
  assert.equal(boolDoRelatorio(undefined), null);
  assert.deepEqual(problemasDoRelatorio(null), { flags: [], notas: [] });
  assert.deepEqual(problemasDoRelatorio({ completion_status: "complete", follow_up_required: "no" }), { flags: [], notas: [] });
});

test("varredura: só relatório entre 10 minutos e 7 dias", () => {
  const agora = new Date("2026-10-15T12:00:00Z");
  assert.equal(entraNaVarredura("2026-10-15T11:55:00Z", agora), false);
  assert.equal(entraNaVarredura("2026-10-15T11:30:00Z", agora), true);
  assert.equal(entraNaVarredura("2026-10-08T12:30:00Z", agora), true);
  assert.equal(entraNaVarredura("2026-10-08T11:00:00Z", agora), false);
  assert.equal(entraNaVarredura(null, agora), false);
  assert.equal(entraNaVarredura("garbage", agora), false);
});

test("sem conseguir ler o ticket, fica para a equipe", () => {
  const d = decidirFinalCheck(base({ complaintUnknown: true }));
  assert.equal(d.acao, "equipe");
  assert.match(d.acao === "equipe" ? d.motivo : "", /could not read/);
});
