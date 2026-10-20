import { test } from "node:test";
import assert from "node:assert/strict";
import { jobDoTokenDoRelatorio, semanaAnterior, tokenDoRelatorio } from "./fatura-semanal";

test("a semana fechada é a segunda a domingo anteriores (Londres)", () => {
  assert.deepEqual(semanaAnterior(new Date("2026-10-26T08:00:00Z")), { inicio: "2026-10-19", fim: "2026-10-25", rotulo: "19 Oct to 25 Oct" });
  // rodando no domingo à noite ainda conta a semana anterior
  assert.equal(semanaAnterior(new Date("2026-10-25T22:00:00Z")).inicio, "2026-10-12");
});

test("o link do relatório abre só o job assinado", () => {
  const id = "bcac1c27-26ad-49c5-9cd1-865d0263c215";
  const t = tokenDoRelatorio(id);
  assert.equal(jobDoTokenDoRelatorio(t), id);
  assert.equal(jobDoTokenDoRelatorio(t.replace(/.$/, (c) => (c === "A" ? "B" : "A"))), null);
  assert.equal(jobDoTokenDoRelatorio("lixo"), null);
});
