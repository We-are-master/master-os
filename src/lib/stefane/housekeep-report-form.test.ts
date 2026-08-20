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
    start: {
      scope_changes: true,
      scope_changes_note: "Customer asked for the oven as well.",
      scope_changes_approved: true,
      pre_existing_damage: false,
      photos_refused: false,
      recommend_additional_services: true,
      recommend_services_note: "Carpets would benefit from a steam clean.",
    },
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
      additional_charges_note: "Replaced two hinges, £18.",
      additional_charges_approved: true,
      completion_status: "Completed",
      what_needs_completing: null,
      follow_up_required: false,
    },
    inicio: "2026-08-13T14:00:00Z",
    fim: "2026-08-13T15:30:00Z",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // A cobrança aparece nos DOIS lugares de propósito: no campo próprio, que a
  // Housekeep passou a exigir, e na descrição, que é a prosa que o cliente lê.
  assert.match(r.payload.descricao, /^Rehung the kitchen cabinet door and adjusted the hinges\./);
  assert.match(r.payload.descricao, /Additional charges: Replaced two hinges, £18\./);
  assert.equal(r.payload.cobrancaExtra, true);
  assert.equal(r.payload.trabalhoAdicionalCobranca, "Replaced two hinges, £18.");
  assert.equal(r.payload.clienteAprovouCobranca, true);
  assert.equal(r.payload.conclusao, CONCLUSAO.completo);
  assert.ok(r.ok);
  assert.equal(r.payload.precisaRetorno, false);
  assert.equal(r.payload.inicio, "15:00");
  assert.equal(r.payload.fim, "16:30");
  assert.equal(r.payload.feedback, FEEDBACK.bom);
});

/**
 * "Describe additional work" nasce escondido e só aparece quando o retorno é
 * "Yes", e nesse instante vira obrigatório. Ficou fora do mapa porque a
 * varredura do formulário só enumera o que está na página, e ele não está até
 * alguém responder Yes.
 *
 * O JOB-9428 foi recusado duas vezes por isso, com a mensagem "This field is
 * required" colada na pergunta do retorno, que já estava respondida. É o tipo
 * de campo que só se descobre com o formulário aberto na frente.
 */
test("retorno com Yes leva o texto do trabalho adicional", () => {
  const r = payloadDoReport({
    final: {
      description: "Fixed the leak under the sink.",
      follow_up_required: true,
      what_needs_completing: "Needs a new trap, coming back once the part arrives.",
    },
    inicio: null,
    fim: null,
  });
  assert.equal(r.ok, true);
  assert.equal(r.payload.precisaRetorno, true);
  assert.equal(r.payload.trabalhoAdicional, "Needs a new trap, coming back once the part arrives.");
});

test("sem o que falta, o trabalho adicional cai na descrição em vez de ir vazio", () => {
  const r = payloadDoReport({
    final: { description: "Fixed the leak.", follow_up_required: true },
    inicio: null,
    fim: null,
  });
  assert.ok(r.ok);
  assert.equal(r.payload.trabalhoAdicional, "Fixed the leak.");
});

test("sem retorno o campo fica nulo, porque nem existe na página", () => {
  const r = payloadDoReport({
    final: { description: "All done.", follow_up_required: false, what_needs_completing: "nada" },
    inicio: null,
    fim: null,
  });
  assert.ok(r.ok);
  assert.equal(r.payload.precisaRetorno, false);
  assert.equal(r.payload.trabalhoAdicional, null);
});

test("JOB-9450: relatório chapado num formulário de limpeza não vira 'job incompleto'", () => {
  /**
   * O parceiro digitou um `general` num End of Tenancy: ali não existe
   * `job_complete`, existe `completion_status`. Ler só a primeira chave dava
   * `undefined`, `Boolean(undefined)` é false, e a Stefane respondeu
   * "Is the job complete? No" num job concluído. Responder "No" abre dois
   * campos de texto obrigatórios, e foi assim que a Housekeep recusou o envio.
   */
  const r = payloadLimpeza({
    start: { recommend_additional_services: false },
    final: { completion_status: "complete", description: "All good", follow_up_required: true },
    inicio: "2026-08-19T16:01:05Z",
    fim: "2026-08-19T16:03:29Z",
  });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.payload.jobCompleto, true);
});

test("não concluiu e não disse o que falta: bloqueia em vez de mandar vazio", () => {
  /**
   * O JOB-9450, na origem. "Is the job complete? No" revela DOIS campos
   * obrigatórios na limpeza, e mandá-los em branco é como a Housekeep recusa
   * sem dizer qual campo era. Bloquear aqui devolve o nome do campo a quem
   * consegue preencher.
   */
  const r = payloadLimpeza({
    start: {},
    final: { completion_status: "partially_complete" },
    inicio: null,
    fim: null,
  });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.motivo, /What still needs to be completed/);
});

test("não concluiu mas disse o que falta: passa, e os dois campos vão preenchidos", () => {
  const r = payloadLimpeza({
    start: {},
    final: { completion_status: "partially_complete", what_needs_completing: "Oven still to do." },
    inicio: null,
    fim: null,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.payload.jobCompleto, false);
  assert.equal(r.payload.faltaFazer, "Oven still to do.");
  // O "porquê" reaproveita o que falta quando ninguém escreveu um motivo
  // separado: são a mesma informação, e deixar em branco é recusa na certa.
  assert.equal(r.payload.porqueIncompleto, "Oven still to do.");
});

test("relatório de limpeza de verdade continua mandando na resposta", () => {
  // `job_complete` explícito ganha do `completion_status`: quem preencheu o
  // formulário de limpeza respondeu essa pergunta de propósito.
  const r = payloadLimpeza({
    start: {},
    final: { job_complete: false, completion_status: "complete", what_needs_completing: "Bathroom left for tomorrow." },
    inicio: null,
    fim: null,
  });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.payload.jobCompleto, false);
});

test("cobrança extra sem dizer qual: bloqueia com o nome do campo", () => {
  /**
   * Três jobs da base (9303, 9368, 9370) marcaram cobrança extra. O formulário
   * de trade revela dois campos obrigatórios nesse instante, e até 20/08/2026
   * nenhum deles era preenchido: o Submit era recusado sem dizer qual faltava.
   */
  const r = payloadDoReport({
    final: { description: "Fixed the leaking trap under the sink.", additional_charges: true },
    inicio: null,
    fim: null,
  });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.motivo, /What additional work was required/);
});

test("parceiro recomendou serviço e a resposta dele chega inteira", () => {
  /**
   * Até 20/08/2026 a Stefane respondia SEMPRE "não" a esta pergunta, sem ler o
   * relatório: três jobs da base tinham o parceiro recomendando serviço e a
   * Housekeep recebeu "não". Perdia o upsell e reportava errado, em silêncio.
   */
  const r = payloadDoReport({
    final: { description: "Serviced the boiler and bled the radiators." },
    start: { recommend_additional_services: true, recommend_services_note: "Radiators need a power flush." },
    inicio: null,
    fim: null,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.payload.recomendaServicos, true);
  assert.equal(r.payload.servicosRecomendados, "Radiators need a power flush.");
});

test("recomendou mas não disse o quê: bloqueia em vez de responder 'não' por cima", () => {
  const r = payloadDoReport({
    final: { description: "Serviced the boiler and bled the radiators." },
    start: { recommend_additional_services: true },
    inicio: null,
    fim: null,
  });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.motivo, /Describe the recommended services/);
});

test("limpeza: dano prévio sem descrição bloqueia", () => {
  const r = payloadLimpeza({
    start: { pre_existing_damage: true },
    final: { job_complete: true },
    inicio: null,
    fim: null,
  });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.motivo, /Describe the damage observed/);
});

test("jardim: o que o jardineiro escreveu chega inteiro na Housekeep", () => {
  /**
   * O template de jardim tem nomes próprios para três coisas que o formulário
   * de trade pergunta, e até 20/08/2026 os três eram descartados no
   * transporte. O pior era a contradição: o radio dizia "Additional charges?
   * No" e a descrição logo abaixo dizia "Materials/parts used: £24".
   */
  const r = payloadDoReport({
    start: { number_of_gardeners: 2 },
    final: {
      description: "Cut back the hedge, mowed the lawn and cleared the borders.",
      materials_charges: true,
      materials_charges_note: "Two bags of bark mulch, £24.",
      all_tasks_done: true,
      next_visit_tasks: "Hedge will need another cut in 6 weeks.",
      seasonal_maintenance: "Feed the lawn in spring.",
    },
    inicio: null,
    fim: null,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.payload.conclusao, CONCLUSAO.completo);
  // cobrança de material É cobrança adicional para eles
  assert.equal(r.payload.cobrancaExtra, true);
  assert.equal(r.payload.trabalhoAdicionalCobranca, "Two bags of bark mulch, £24.");
  // "o que fica para a próxima visita" É o retorno que eles perguntam
  assert.equal(r.payload.precisaRetorno, true);
  assert.equal(r.payload.trabalhoAdicional, "Hedge will need another cut in 6 weeks.");
  // manutenção sazonal É recomendação de serviço
  assert.equal(r.payload.recomendaServicos, true);
  assert.equal(r.payload.servicosRecomendados, "Feed the lawn in spring.");
});

test("jardim sem nada extra continua respondendo 'não' aos três", () => {
  const r = payloadDoReport({
    final: { description: "Mowed the lawn and edged the borders.", all_tasks_done: true },
    inicio: null,
    fim: null,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.payload.cobrancaExtra, false);
  assert.equal(r.payload.precisaRetorno, false);
  assert.equal(r.payload.recomendaServicos, false);
  assert.equal(r.payload.trabalhoAdicional, null);
});

test("cobrou material e não disse quanto: bloqueia", () => {
  const r = payloadDoReport({
    final: { description: "Trimmed the hedges.", materials_charges: true },
    inicio: null,
    fim: null,
  });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.motivo, /What additional work was required/);
});
