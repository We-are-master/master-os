import { test } from "node:test";
import assert from "node:assert/strict";
import { emailDaFaturaSemanal, jobDoTokenDoRelatorio, semanaAnterior, tokenDoRelatorio } from "./fatura-semanal";

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

test("o e-mail lista cada job com relatório e o total", () => {
  const html = emailDaFaturaSemanal({
    conta: "Li & Fung",
    reference: "INV-2026-1500",
    rotulo: "19 Oct to 25 Oct",
    total: 420,
    due: "2026-10-30",
    linhas: [
      { jobId: "a", reference: "JOB-9801", title: "General Maintenance", address: "1 Office St", completed: "2026-10-20", amount: 180, reportUrl: "https://x/r/a" },
      { jobId: "b", reference: "JOB-9802", title: "Painter", address: null, completed: null, amount: 240, reportUrl: "https://x/r/b" },
    ],
  });
  assert.match(html, /JOB-9801/);
  assert.match(html, /JOB-9802/);
  assert.match(html, /https:\/\/x\/r\/b/);
  assert.match(html, /£420\.00/);
  assert.match(html, /Li &amp; Fung/);
  assert.doesNotMatch(html, /—/);
});
