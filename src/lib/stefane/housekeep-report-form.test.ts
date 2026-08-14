import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  CONCLUSAO,
  FEEDBACK,
  conclusaoParaHousekeep,
  formaDoFormulario,
  horaLondres,
  payloadDoReport,
  payloadLimpeza,
} from "./housekeep-report-form";

test("reconhece qual dos dois formulários está aberto", () => {
  // Campos reais lidos de JOB-9428 (Handyman) e JOB-9416 (End-of-tenancy).
  const trade = ["2kz3prnflbrj", "9vzq8kmtvz6p", "vxowxmk0gvz2-0", "6jovglk0ylop-1"];
  const limpeza = ["2kz3prnflbrj", "v3ba2epfyoem-0", "gkbj9y40qgz4-1", "2kz3prnfllbr-0"];
  assert.equal(formaDoFormulario(trade), "trade");
  assert.equal(formaDoFormulario(limpeza), "limpeza");
});

test("formulário irreconhecível não vira palpite", () => {
  // Se a Housekeep republicar o formulário, os ids mudam de uma vez. Melhor
  // parar dizendo que mudou do que preencher metade dos campos.
  assert.equal(formaDoFormulario(["algo", "outro"]), null);
  assert.equal(formaDoFormulario([]), null);
});

test("limpeza: campos vêm do start e do final, cada um do seu", () => {
  const r = payloadLimpeza({
    start: { scope_changes: true, pre_existing_damage: false, photos_refused: false, recommend_additional_services: true },
    final: { job_complete: true, customer_inspected: false },
    inicio: "2026-08-13T08:00:00Z",
    fim: "2026-08-13T12:30:00Z",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.payload.escopoMudou, true);
  assert.equal(r.payload.jobCompleto, true);
  assert.equal(r.payload.clienteInspecionou, false);
  assert.equal(r.payload.recomendaServicos, true);
  assert.equal(r.payload.inicio, "09:00");
  assert.equal(r.payload.fim, "13:30");
});

test("limpeza sem report final não é enviada", () => {
  const r = payloadLimpeza({ start: { scope_changes: false }, final: null, inicio: null, fim: null });
  assert.equal(r.ok, false);
});

test("conclusão: os três valores do select viram o radio certo", () => {
  // O select do OS manda exatamente estes três. O regex sozinho mandava
  // `could_not_complete` como concluído (contém "complete") e
  // `partially_complete` como materiais (contém "part").
  assert.equal(conclusaoParaHousekeep("complete"), CONCLUSAO.completo);
  assert.equal(conclusaoParaHousekeep("partially_complete"), CONCLUSAO.maisTempo);
  assert.equal(conclusaoParaHousekeep("could_not_complete"), CONCLUSAO.maisTempo);
});

test("job que não deu para fazer NUNCA é reportado como concluído", () => {
  // O erro caro: fecha o job do lado deles e some com a chance de voltar.
  assert.notEqual(conclusaoParaHousekeep("could_not_complete"), CONCLUSAO.completo);
  assert.notEqual(conclusaoParaHousekeep("partially_complete"), CONCLUSAO.completo);
  assert.notEqual(conclusaoParaHousekeep("could not complete"), CONCLUSAO.completo);
});

test("'partially_complete' não pode virar 'materiais' por conter 'part'", () => {
  assert.notEqual(conclusaoParaHousekeep("partially_complete"), CONCLUSAO.materiais);
  // E "parts" solto continua sendo materiais, que é a intenção real.
  assert.equal(conclusaoParaHousekeep("waiting on parts"), CONCLUSAO.materiais);
});

test("gardener conclui por all_tasks_done, que é o campo que ele tem", () => {
  // Jardinagem cai no formulário de trade, mas o template gardener não tem
  // completion_status: sem a ponte, jardim inteiro feito ia como incompleto.
  const feito = payloadDoReport({
    final: { description: "Hedges trimmed, lawn mowed.", all_tasks_done: true },
    inicio: null,
    fim: null,
  });
  assert.equal(feito.ok, true);
  assert.equal(feito.ok && feito.payload.conclusao, CONCLUSAO.completo);

  const pendente = payloadDoReport({
    final: { description: "Ran out of daylight.", all_tasks_done: false },
    inicio: null,
    fim: null,
  });
  assert.equal(pendente.ok && pendente.payload.conclusao, CONCLUSAO.maisTempo);
});

test("material e nota de cobrança chegam na descrição, em vez de sumir", () => {
  // O formulário de trade só tem um radio sim/não para cobrança e nenhum campo
  // de material: a descrição é o único lugar onde isso chega a um humano.
  const r = payloadDoReport({
    final: {
      description: "Assembled the wardrobe.",
      materials_used: "2 wall brackets, 8 screws",
      additional_charges: true,
      additional_charges_note: "£15 for the brackets",
    },
    inicio: null,
    fim: null,
  });
  assert.equal(r.ok, true);
  const d = r.ok ? r.payload.descricao : "";
  assert.match(d, /^Assembled the wardrobe\./);
  assert.match(d, /Materials\/parts used: 2 wall brackets, 8 screws/);
  assert.match(d, /Additional charges: £15 for the brackets/);
});

test("sem material nem cobrança, a descrição sai intacta", () => {
  const r = payloadDoReport({
    final: { description: "Assembled the wardrobe." },
    inicio: null,
    fim: null,
  });
  assert.equal(r.ok && r.payload.descricao, "Assembled the wardrobe.");
});

test("gardener: a nota de material dele também para de ser descartada", () => {
  const r = payloadDoReport({
    final: { description: "Hedges trimmed.", materials_charges_note: "3 bags of compost" },
    inicio: null,
    fim: null,
  });
  assert.match(r.ok ? r.payload.descricao : "", /Materials\/parts used: 3 bags of compost/);
});

test("certificado envia usando inspection_summary como descrição", () => {
  // O template de certificado não grava `description`; sem a segunda chave,
  // todo job de certificado morria em "sem descrição do trabalho".
  const r = payloadDoReport({
    final: { inspection_summary: "EICR carried out on all circuits.", certificate_issued: true },
    inicio: null,
    fim: null,
  });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.payload.descricao, "EICR carried out on all circuits.");
});

test("conclusão: texto do parceiro vira o radio certo", () => {
  assert.equal(conclusaoParaHousekeep("Completed"), CONCLUSAO.completo);
  assert.equal(conclusaoParaHousekeep("job done, all good"), CONCLUSAO.completo);
  assert.equal(conclusaoParaHousekeep("needs more time"), CONCLUSAO.maisTempo);
  assert.equal(conclusaoParaHousekeep("Specialist materials needed"), CONCLUSAO.materiais);
  assert.equal(conclusaoParaHousekeep("scope was different"), CONCLUSAO.escopoDiferente);
});

test("conclusão desconhecida nunca vira 'concluído'", () => {
  // Dizer que acabou sem certeza fecha o job do lado deles. Na dúvida, o
  // caminho seguro é pedir mais tempo.
  assert.equal(conclusaoParaHousekeep(null), CONCLUSAO.maisTempo);
  assert.equal(conclusaoParaHousekeep(""), CONCLUSAO.maisTempo);
  assert.equal(conclusaoParaHousekeep("¯\\_(ツ)_/¯"), CONCLUSAO.maisTempo);
});

test("'not complete' não pode casar com 'complete'", () => {
  // A regex de completo tem /complete/, e a de incompleto vem antes de
  // propósito. Se a ordem inverter, este teste quebra.
  assert.equal(conclusaoParaHousekeep("not complete"), CONCLUSAO.maisTempo);
  assert.equal(conclusaoParaHousekeep("not finished"), CONCLUSAO.maisTempo);
});

test("hora sai no fuso de Londres, não no do Mac", () => {
  // 13:05 UTC em agosto é 14:05 em Londres (BST).
  assert.equal(horaLondres("2026-08-13T13:05:00Z"), "14:05");
  assert.equal(horaLondres(null), null);
  assert.equal(horaLondres("nao é data"), null);
});

test("report sem descrição não vira payload", () => {
  const r = payloadDoReport({ final: { completion_status: "Completed" }, inicio: null, fim: null });
  assert.equal(r.ok, false);
  // O motivo aparece na tela, então é inglês; o nome do teste é nosso.
  assert.match(r.ok === false ? r.motivo : "", /work description/);
});

test("report completo vira payload inteiro", () => {
  const r = payloadDoReport({
    final: {
      description: "Rehung the kitchen cabinet door and adjusted the hinges.",
      additional_charges: true,
      completion_status: "Completed",
      what_needs_completing: null,
      follow_up_required: false,
    },
    inicio: "2026-08-13T14:00:00Z",
    fim: "2026-08-13T15:30:00Z",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.payload.descricao, "Rehung the kitchen cabinet door and adjusted the hinges.");
  assert.equal(r.payload.cobrancaExtra, true);
  assert.equal(r.payload.conclusao, CONCLUSAO.completo);
  assert.equal(r.payload.precisaRetorno, false);
  assert.equal(r.payload.inicio, "15:00");
  assert.equal(r.payload.fim, "16:30");
  assert.equal(r.payload.feedback, FEEDBACK.bom);
});
