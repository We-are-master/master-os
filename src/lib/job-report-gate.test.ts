/**
 * O portão de finalizar: só passa job com relatório preenchido.
 *
 * A regra sempre foi da operação e nunca esteve no código. Até 16/08/2026,
 * `canAdvanceJob` deixava qualquer job em Final check avançar para Awaiting
 * payment, porque a segunda linha do teste abaixo, `job.status === "final_check"`,
 * respondia `ok` antes de alguém perguntar pelo relatório. Job sem uma linha
 * escrita virava invoice na mão do cliente.
 *
 * Os casos aqui são os que a base tinha no dia: cinco jobs parados em Final
 * check, todos sem relatório nenhum. Nenhum deles passa mais.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildJobReviewApprovalPatch,
  canAdvanceJob,
  canSendReportAndRequestFinalPayment,
  jobPatchApprovesReport,
  reportCompletionGate,
} from "./job-phases";
import type { Job } from "@/types/database";

const comodos = ["living_room", "hallways", "kitchen", "bathrooms", "bedrooms"];
const fotos = (n: number) => Object.fromEntries(comodos.map((c) => [c, Array(n).fill("u")]));

/** Job de limpeza com tudo no lugar: é o que deve passar. */
function jobLimpezaCompleto(over: Partial<Job> = {}): Job {
  return {
    id: "j1",
    reference: "JOB-1",
    title: "End of tenancy cleaning",
    status: "final_check",
    final_report_submitted: true,
    start_report: { template: "cleaner", photos: { equipment: Array(5).fill("u"), ...fotos(5) } },
    final_report: { template: "cleaner", photos: fotos(5) },
    partner_timer_started_at: "2026-08-13T08:00:00Z",
    partner_timer_ended_at: "2026-08-13T12:00:00Z",
    ...over,
  } as unknown as Job;
}

test("relatório completo passa", () => {
  const gate = reportCompletionGate(jobLimpezaCompleto());
  assert.equal(gate.ok, true);
});

test("job sem relatório nenhum não finaliza, mesmo estando em Final check", () => {
  // O caso exato dos cinco jobs presos na base: status certo, relatório zero.
  const job = jobLimpezaCompleto({
    final_report_submitted: false,
    start_report: null,
    final_report: null,
  });
  const gate = reportCompletionGate(job);
  assert.equal(gate.ok, false);
  assert.match(gate.message ?? "", /not complete/i);
});

test("canAdvanceJob deixou de aceitar Final check como resposta suficiente", () => {
  // Esta é a regressão que o portão fecha. Antes: { ok: true }.
  const job = jobLimpezaCompleto({
    final_report_submitted: false,
    start_report: null,
    final_report: null,
  });
  const r = canAdvanceJob(job, "awaiting_payment");
  assert.equal(r.ok, false);
});

test("a mensagem diz o que falta, não só que falta", () => {
  const job = jobLimpezaCompleto({ final_report: { template: "cleaner", photos: {} } });
  const gate = reportCompletionGate(job);
  assert.equal(gate.ok, false);
  // Quem lê está com o job aberto e ainda pode resolver.
  assert.match(gate.message ?? "", /after photos/i);
  assert.match(gate.message ?? "", /office report/i);
});

test("limpeza não é cobrada por descrição, e certificado não é cobrado por foto de antes", () => {
  // O portão herda o que reportHealth já sabe sobre cada formulário. Se cobrasse
  // prosa de um formulário que não tem campo de texto, recusaria trabalho bom.
  const limpeza = reportCompletionGate(jobLimpezaCompleto());
  assert.equal(limpeza.ok, true);

  const certificado = reportCompletionGate({
    id: "j2",
    reference: "JOB-2",
    title: "EICR Safety Check",
    status: "final_check",
    final_report_submitted: true,
    start_report: null,
    final_report: {
      template: "certificate",
      description: "Consumer unit tested, no faults found.",
      photos: { certificate: ["u"] },
    },
    partner_timer_started_at: "2026-08-13T08:00:00Z",
    partner_timer_ended_at: "2026-08-13T10:00:00Z",
  } as unknown as Job);
  assert.equal(certificado.ok, true);
});

test("rebobinar não passa pelo portão", () => {
  // Voltar de awaiting_payment para final_check é conserto, não avanço: exigir
  // relatório ali prenderia justamente quem está tentando arrumar o relatório.
  const job = jobLimpezaCompleto({
    status: "awaiting_payment",
    final_report_submitted: false,
    start_report: null,
    final_report: null,
  });
  assert.equal(canAdvanceJob(job, "final_check").ok, true);
});

test("relatório vazio não vira email para o cliente", () => {
  // O caminho "Review & Approve" manda relatório e invoice ao cliente sem passar
  // por canAdvanceJob, então tinha o mesmo furo e um custo maior: documento na
  // mão de quem paga.
  const vazio = jobLimpezaCompleto({
    final_report_submitted: false,
    start_report: null,
    final_report: null,
  });
  assert.equal(canSendReportAndRequestFinalPayment(vazio).ok, false);
  assert.equal(canSendReportAndRequestFinalPayment(jobLimpezaCompleto()).ok, true);
});

test("o gancho reconhece o patch que os dois caminhos de aprovação produzem", () => {
  // É o sinal que dispara o envio para a plataforma do cliente. Se parar de
  // reconhecer o patch, o envio volta a depender de alguém lembrar de clicar.
  assert.equal(jobPatchApprovesReport(buildJobReviewApprovalPatch()), true);
  assert.equal(
    jobPatchApprovesReport(buildJobReviewApprovalPatch({ reviewSendMethod: "email" })),
    true,
  );
});

test("o gancho não dispara em salvamento comum", () => {
  // Lê o patch e não a linha: job aprovado ontem não pode reenviar a cada
  // mudança de preço ou de data.
  assert.equal(jobPatchApprovesReport({ extras_amount: 40 } as Partial<Job>), false);
  assert.equal(jobPatchApprovesReport({ status: "awaiting_payment" } as Partial<Job>), false);
  assert.equal(jobPatchApprovesReport({}), false);
});

test("cancelar e pôr em espera continuam livres", () => {
  const job = jobLimpezaCompleto({
    final_report_submitted: false,
    start_report: null,
    final_report: null,
  });
  assert.equal(canAdvanceJob(job, "cancelled").ok, true);
  assert.equal(canAdvanceJob(job, "on_hold").ok, true);
});
