import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmaNoNascimento } from "./confirmacao-no-nascimento";

const agora = new Date("2026-11-10T13:40:00Z");

test("job acabado de nascer, marcado para a semana que vem, confirma", () => {
  assert.equal(confirmaNoNascimento({ createdAt: "2026-11-10T13:39:00Z", dia: "2026-11-19" }, agora), true);
});

test("job para hoje confirma", () => {
  assert.equal(confirmaNoNascimento({ createdAt: "2026-11-10T13:00:00Z", dia: "2026-11-10" }, agora), true);
});

test("Unassigned antigo não confirma pela varredura", () => {
  assert.equal(confirmaNoNascimento({ createdAt: "2026-11-02T10:00:00Z", dia: "2026-11-19" }, agora), false);
});

test("data no passado nunca confirma", () => {
  assert.equal(confirmaNoNascimento({ createdAt: "2026-11-10T13:39:00Z", dia: "2026-11-09" }, agora), false);
});

test("sem data de criação ou sem dia não confirma", () => {
  assert.equal(confirmaNoNascimento({ createdAt: null, dia: "2026-11-19" }, agora), false);
  assert.equal(confirmaNoNascimento({ createdAt: "2026-11-10T13:39:00Z", dia: "" }, agora), false);
});
