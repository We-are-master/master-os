import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  ehLinkHousekeep,
  faltasDeFoto,
  formaDoFormularioAPI,
  perguntaVisivel,
  slotsDeFoto,
  uuidDoLink,
  type FormularioHousekeep,
  type PerguntaHousekeep,
} from "./housekeep-api";

/**
 * Formulário de LIMPEZA, copiado da resposta real da API no JOB-9450
 * (20/08/2026). Os mínimos por cômodo são deles, não nossos: 5 de sala, 3 de
 * corredor, 5 de cozinha, 5 de banheiro, 5 de quarto, 1 a 2 de equipamento.
 */
function pergunta(p: Partial<PerguntaHousekeep> & { id: string }): PerguntaHousekeep {
  return {
    secao: "",
    texto: "",
    tipo: "string",
    resposta: null,
    min: null,
    max: null,
    mostrarSe: null,
    ...p,
  };
}

const foto = (id: string, secao: string, texto: string, min: number, max: number, temLa = 0) =>
  pergunta({
    id,
    secao,
    texto,
    tipo: "document",
    min,
    max,
    resposta: Array.from({ length: temLa }, (_, i) => `doc-${i}`),
    // Todos os treze campos de foto somem quando o cliente recusa fotos.
    mostrarSe: { pergunta: "xvz9pjmflkbq", operador: "==", valor: "false" },
  });

function formLimpeza(recusouFotos = "false"): FormularioHousekeep {
  return {
    url: "https://housekeep.com/job-reports/e58a68bc58dc4d6fa3cdbb881285749b",
    uuid: "e58a68bc58dc4d6fa3cdbb881285749b",
    status: "service-provider-to-fill-out",
    submetidoEm: null,
    perguntas: [
      pergunta({ id: "2kz3prnflbrj", secao: "Start job", texto: "Start time", tipo: "time", resposta: "17:01" }),
      pergunta({ id: "xvz9pjmflkbq", secao: "Before photos", texto: "Did the customer refuse to have photos taken?", tipo: "boolean", resposta: recusouFotos }),
      foto("9vzq8kmtg8z6", "Before photos", "Cleaning equipment", 1, 2),
      foto("nqolmdn19xz2", "Before photos", "Living room (include: windows, skirting boards and floors)", 5, 20),
      foto("gkbj9y4076z4", "Before photos", "Hallways (include: skirting boards and floors)", 3, 20),
      foto("mxb6ynpf6lop", "Before photos", "Kitchen (include: oven, hob, fridge/freezer, sink and floors)", 5, 20),
      foto("7dzn2xjf8qz5", "Before photos", "Bathrooms (include: sink, toilet, showers, mirrors and floors)", 5, 20),
      foto("e2z4lpxhw6o4", "Before photos", "Bedrooms (include: mirrors, windows, skirting boards and floors)", 5, 20),
      foto("v3ba2epfekoe", "Before photos", "Steam cleaning if booked in", 0, 10),
      pergunta({ id: "gkbj9y40qgz4", secao: "Finish job", texto: "Is the job complete?", tipo: "boolean", resposta: "false" }),
      pergunta({
        id: "dnb5qnrc8qb4",
        secao: "Finish job",
        texto: "What still needs to be completed?",
        min: 1,
        max: 1000,
        mostrarSe: { pergunta: "gkbj9y40qgz4", operador: "==", valor: "false" },
      }),
      foto("vxowxmk08pz2", "After photos", "Living room (include: windows, skirting boards and floors)", 5, 20),
      foto("6jovglk0x2op", "After photos", "Hallways (include: skirting boards and floors)", 3, 20),
      foto("6wbkjmy09kz7", "After photos", "Kitchen (include: oven, hob, fridge/freezer, sink and floors)", 5, 20),
      foto("78zpg340v3zk", "After photos", "Bathrooms (include: sink, toilet, showers, mirrors and floors)", 5, 20),
      foto("lnb7aqj0dvbe", "After photos", "Bedrooms (include: mirrors, windows, skirting boards and floors)", 5, 20),
      foto("59oyg870p7ox", "After photos", "Steam cleaning if booked in", 0, 10),
    ],
  };
}

/** Formulário de TRADE, do JOB-9451 (EPC): dois campos de foto, não treze. */
const formTrade: FormularioHousekeep = {
  url: "https://housekeep.com/job-reports/6c94ef6902c24bbe899a8d2f789fc797",
  uuid: "6c94ef6902c24bbe899a8d2f789fc797",
  status: "service-provider-to-fill-out",
  submetidoEm: null,
  perguntas: [
    pergunta({ id: "2kz3prnflbrj", secao: "Start job", texto: "Start time", tipo: "time" }),
    pergunta({ id: "9vzq8kmtvz6p", secao: "Finish job", texto: "Description of work done" }),
    pergunta({ id: "7dzn2xjf5z5r", secao: "Start job", texto: "Before photos", tipo: "document", min: 1, max: 20, resposta: [] }),
    pergunta({ id: "e2z4lpxhdo4v", secao: "Finish job", texto: "After photos", tipo: "document", min: 1, max: 20, resposta: [] }),
  ],
};

test("aceita o link canônico e o rastreador de email", () => {
  // Seis jobs da base guardam o link de rastreio, e ele não casava com a regex
  // antiga: esses jobs eram reportados como plataforma não automatizada.
  assert.equal(ehLinkHousekeep("https://housekeep.com/job-reports/abc123def456"), true);
  assert.equal(ehLinkHousekeep("https://links.housekeep.com/ls/click?upn=u001.hgeYll"), true);
  assert.equal(ehLinkHousekeep("https://membersapp.checkatrade.com/business-jobs/x"), false);
  assert.equal(ehLinkHousekeep(null), false);
});

test("o uuid sai da url canônica, e o rastreador não finge ter um", () => {
  assert.equal(uuidDoLink("https://housekeep.com/job-reports/e58a68bc58dc4d6fa3cdbb881285749b?utm=x"), "e58a68bc58dc4d6fa3cdbb881285749b");
  assert.equal(uuidDoLink("https://links.housekeep.com/ls/click?upn=u001.abc"), null);
});

test("reconhece os dois formulários pelos ids que a API lista", () => {
  assert.equal(formaDoFormularioAPI(formLimpeza()), "limpeza");
  assert.equal(formaDoFormularioAPI(formTrade), "trade");
});

test("campo escondido não é campo exigido", () => {
  const f = formLimpeza();
  const faltaFazer = f.perguntas.find((q) => q.id === "dnb5qnrc8qb4")!;
  // "Is the job complete?" está em false, então o campo aparece e é exigido.
  assert.equal(perguntaVisivel(f, faltaFazer), true);

  const completo = formLimpeza();
  completo.perguntas.find((q) => q.id === "gkbj9y40qgz4")!.resposta = "true";
  assert.equal(perguntaVisivel(completo, faltaFazer), false);
});

test("cliente que recusou fotos apaga a exigência de foto inteira", () => {
  // Treze campos condicionados à mesma resposta. Exigir foto de um job em que
  // o cliente proibiu foto recusaria o relatório por um motivo que não existe.
  assert.equal(slotsDeFoto(formLimpeza("false")).length, 13);
  assert.equal(slotsDeFoto(formLimpeza("true")).length, 0);
});

test("cada campo vira um slot com a chave do nosso lado e o limite deles", () => {
  const slots = slotsDeFoto(formLimpeza());
  const cozinhaAntes = slots.find((s) => s.chave === "kitchen" && s.metade === "antes")!;
  assert.equal(cozinhaAntes.min, 5);
  assert.equal(cozinhaAntes.max, 20);
  assert.equal(cozinhaAntes.rotulo, "Kitchen");

  // O teto de 2 do equipamento é o que fazia 20 fotos serem recusadas ali.
  const equipamento = slots.find((s) => s.chave === "equipment")!;
  assert.equal(equipamento.max, 2);

  // "After photos" alimenta a metade de depois, e o de limpeza não tem
  // equipamento no depois: seis campos lá contra sete no antes.
  assert.equal(slots.filter((s) => s.metade === "antes").length, 7);
  assert.equal(slots.filter((s) => s.metade === "depois").length, 6);
});

test("JOB-9450: 20 fotos soltas não passam no formulário de limpeza", () => {
  /**
   * O caso que custou o relatório. O parceiro digitou um `general` num End of
   * Tenancy, então as fotos vieram em lista plana e nenhuma tem cômodo. A
   * Housekeep pede 24 no antes e 23 no depois, separadas. Bloquear aqui é o
   * que devolve a lista exata para pedir ao parceiro no mesmo dia.
   */
  const faltas = faltasDeFoto(formLimpeza(), { antes: { all: 20 }, depois: { all: 20 } });
  // 6 no antes (equipamento + cinco cômodos) e 5 no depois. Vapor fica fora
  // dos dois porque o mínimo dele é zero.
  assert.equal(faltas.length, 11);
  assert.ok(faltas.some((f) => f.includes("before · Kitchen: 0 of 5 photos")));
  assert.ok(faltas.some((f) => f.includes("after · Hallways: 0 of 3 photos")));
  // Vapor tem mínimo zero e não pode aparecer como falta.
  assert.ok(!faltas.some((f) => f.includes("Steam")));
});

test("JOB-9449: relatório por cômodo passa em todos os campos", () => {
  // Contagens reais do Deep Cleaning de 20/08/2026, da RJ Cleaner Services.
  const porComodo = { kitchen: 20, bedrooms: 12, hallways: 10, bathrooms: 12, equipment: 2, living_room: 6 };
  assert.deepEqual(faltasDeFoto(formLimpeza(), { antes: porComodo, depois: porComodo }), []);
});

test("foto que já está na plataforma conta para o mínimo", () => {
  // Reenvio de um relatório meio subido não pode pedir de novo o que já está
  // lá, senão um job volta a ser bloqueado por foto que a Housekeep já tem.
  const f = formLimpeza();
  for (const q of f.perguntas) {
    if (q.tipo === "document" && q.min && q.min > 0) q.resposta = Array.from({ length: q.min }, (_, i) => `ja-${i}`);
  }
  assert.deepEqual(faltasDeFoto(f, { antes: {}, depois: {} }), []);
});

test("formulário de trade cobra o balde único, não os cômodos", () => {
  assert.deepEqual(faltasDeFoto(formTrade, { antes: { all: 1 }, depois: { all: 1 } }), []);
  const semNada = faltasDeFoto(formTrade, { antes: { all: 0 }, depois: { all: 0 } });
  assert.equal(semNada.length, 2);
});
