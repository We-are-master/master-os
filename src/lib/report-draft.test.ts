/**
 * O rascunho existe porque um relatório se perdeu, então o que se testa aqui é
 * exatamente o que aconteceu: alguém digitou vários minutos, a aba morreu, e o
 * trabalho tinha que estar lá na volta.
 *
 * Os casos negativos importam tanto quanto: rascunho de outro template, velho
 * demais ou corrompido não pode voltar, porque um rascunho errado aplicado por
 * cima é pior do que rascunho nenhum. Quem digita confia no que está na tela.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  salvarRascunho,
  lerRascunho,
  apagarRascunho,
  temConteudo,
  chaveDoRascunho,
  VALIDADE_MS,
} from "./report-draft";

// node:test não tem DOM: um localStorage de mentira, com o mesmo contrato.
const memoria = new Map<string, string>();
const falso = {
  getItem: (k: string) => memoria.get(k) ?? null,
  setItem: (k: string, v: string) => void memoria.set(k, v),
  removeItem: (k: string) => void memoria.delete(k),
};
(globalThis as { localStorage?: unknown }).localStorage = falso;

const JOB = "b80e6fd2-7d95-4e3f-aeba-2781627aa768";
const corpo = {
  data: { scope_changes: false, job_complete: true, description: "Deep cleaned the flat" },
  visitYmd: "2026-08-13",
  startTime: "09:00",
  finishTime: "14:30",
};

beforeEach(() => memoria.clear());

test("o que foi digitado volta depois da aba morrer", () => {
  salvarRascunho(JOB, "cleaner", corpo);
  const r = lerRascunho(JOB, "cleaner");
  assert.ok(r, "o rascunho tinha que estar lá");
  assert.deepEqual(r.data, corpo.data);
  assert.equal(r.startTime, "09:00");
  assert.equal(r.finishTime, "14:30");
  assert.equal(r.visitYmd, "2026-08-13");
});

test("rascunho de outro template é ignorado", () => {
  // O job pode mudar de forma entre uma sessão e outra: os campos do relatório
  // chapado não têm onde entrar no de limpeza.
  salvarRascunho(JOB, "general", corpo);
  assert.equal(lerRascunho(JOB, "cleaner"), null);
  assert.ok(lerRascunho(JOB, "general"));
});

test("rascunho velho não ressuscita", () => {
  const oitoDiasAtras = Date.now() - VALIDADE_MS - 1;
  salvarRascunho(JOB, "cleaner", corpo, oitoDiasAtras);
  assert.equal(lerRascunho(JOB, "cleaner"), null);
  // No limite ainda vale.
  salvarRascunho(JOB, "cleaner", corpo, Date.now() - VALIDADE_MS + 60_000);
  assert.ok(lerRascunho(JOB, "cleaner"));
});

test("JSON corrompido não derruba o formulário", () => {
  memoria.set(chaveDoRascunho(JOB), "{isso nao e json");
  assert.equal(lerRascunho(JOB, "cleaner"), null);
  memoria.set(chaveDoRascunho(JOB), JSON.stringify({ template: "cleaner", data: "texto solto", salvoEm: Date.now() }));
  assert.equal(lerRascunho(JOB, "cleaner"), null);
});

test("formulário em branco não vira rascunho", () => {
  const vazio = { data: {}, visitYmd: "2026-08-13", startTime: "", finishTime: "" };
  assert.equal(temConteudo(vazio), false);
  salvarRascunho(JOB, "cleaner", vazio);
  assert.equal(lerRascunho(JOB, "cleaner"), null);
  // Só a hora de início já conta como trabalho começado.
  assert.equal(temConteudo({ ...vazio, startTime: "09:00" }), true);
});

test("salvar de verdade apaga o rascunho, senão ele reaparece como se fosse novo", () => {
  salvarRascunho(JOB, "cleaner", corpo);
  apagarRascunho(JOB);
  assert.equal(lerRascunho(JOB, "cleaner"), null);
});

test("cada job tem o seu, e um não invade o outro", () => {
  const outro = "0a4765ac-4dab-4714-9ad6-b41fa0971d08";
  salvarRascunho(JOB, "cleaner", corpo);
  salvarRascunho(outro, "cleaner", { ...corpo, startTime: "11:00" });
  assert.equal(lerRascunho(JOB, "cleaner")?.startTime, "09:00");
  assert.equal(lerRascunho(outro, "cleaner")?.startTime, "11:00");
});

test("localStorage indisponível não quebra nada", () => {
  const antes = (globalThis as { localStorage: unknown }).localStorage;
  (globalThis as { localStorage: unknown }).localStorage = {
    getItem: () => { throw new Error("modo privado"); },
    setItem: () => { throw new Error("cota cheia"); },
    removeItem: () => { throw new Error("nope"); },
  };
  assert.doesNotThrow(() => salvarRascunho(JOB, "cleaner", corpo));
  assert.equal(lerRascunho(JOB, "cleaner"), null);
  assert.doesNotThrow(() => apagarRascunho(JOB));
  (globalThis as { localStorage: unknown }).localStorage = antes;
});
