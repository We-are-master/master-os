/**
 * A nota só serve se for a mesma coisa que a plataforma cobra.
 *
 * Por isso os casos aqui são os motivos reais de recusa que já custaram envio:
 * relatório sem foto de uma das metades, formulário de trade sem descrição,
 * cômodo vazio no formulário de limpeza, e bloco acima do teto de 20, onde o
 * excedente some sem ninguém ver.
 *
 * A regra que mais importa é a última: nota alta com item bloqueante é pior do
 * que nota nenhuma, porque manda a pessoa apertar Approve confiante.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { reportHealth, faixaDaNota } from "./report-health";

const comodos = ["living_room", "hallways", "kitchen", "bathrooms", "bedrooms"];
const cheio = (n: number) => Object.fromEntries(comodos.map((c) => [c, Array(n).fill("u")]));

const limpezaOk = {
  template: "cleaner" as const,
  finalReportSubmitted: true,
  startReport: { photos: { equipment: Array(5).fill("u"), ...cheio(5) } },
  finalReport: { photos: cheio(5) },
  timerStartedAt: "2026-08-13T08:00:00Z",
  timerEndedAt: "2026-08-13T12:00:00Z",
};

test("limpeza completa dá 100 e não bloqueia", () => {
  const s = reportHealth(limpezaOk);
  assert.equal(s.bloqueado, false);
  assert.equal(s.nota, 100);
  assert.equal(s.pendencias.length, 0);
  assert.equal(faixaDaNota(s), "pronto");
});

test("sem foto de depois bloqueia, por mais completo que esteja o resto", () => {
  const s = reportHealth({ ...limpezaOk, finalReport: { photos: {} } });
  assert.equal(s.bloqueado, true);
  assert.equal(faixaDaNota(s), "bloqueado");
  // O item bloqueante encabeça a lista: é o que resolver primeiro.
  assert.equal(s.pendencias[0].chave, "fotos_depois");
  assert.ok(s.nota < 100);
});

test("trade sem descrição bloqueia, e limpeza sem descrição não", () => {
  const base = {
    finalReportSubmitted: true,
    startReport: { photos: ["u"] },
    finalReport: { photos: ["u"] },
    timerStartedAt: "x",
    timerEndedAt: "y",
  };
  const trade = reportHealth({ ...base, template: "general" });
  assert.equal(trade.bloqueado, true, "o formulário de trade tem campo de texto e ele é obrigatório");
  assert.ok(trade.pendencias.some((p) => p.chave === "descricao"));

  const comTexto = reportHealth({ ...base, template: "general", finalReport: { photos: ["u"], description: "Resealed the bath and made good." } });
  assert.equal(comTexto.bloqueado, false);

  // O formulário de limpeza da Housekeep não tem campo de texto nenhum, então
  // cobrar prosa ali seria inventar exigência.
  const limpeza = reportHealth({ ...base, template: "cleaner", startReport: { photos: cheio(5) }, finalReport: { photos: cheio(5) } });
  assert.ok(!limpeza.itens.some((i) => i.chave === "descricao"));
});

test("cômodo pela metade tira nota mas não impede o envio", () => {
  const s = reportHealth({
    ...limpezaOk,
    finalReport: { photos: { ...cheio(5), kitchen: Array(2).fill("u") } },
  });
  assert.equal(s.bloqueado, false, "duas fotos ainda são fotos: a Housekeep aceita");
  assert.ok(s.nota < 100 && s.nota > 80);
  const cozinha = s.pendencias.find((p) => p.chave === "After:kitchen");
  assert.ok(cozinha);
  assert.equal(cozinha.detalhe, "2 of 5");
});

test("bloco acima de 20 aparece, porque o excedente some calado", () => {
  const s = reportHealth({ ...limpezaOk, finalReport: { photos: { ...cheio(5), kitchen: Array(37).fill("u") } } });
  const item = s.pendencias.find((p) => p.chave === "acima_do_teto");
  assert.ok(item, "sem esse aviso, 17 fotos somem sem ninguém ver");
  assert.equal(item.bloqueia, false);
});

test("relatório que não chegou é o primeiro problema", () => {
  const s = reportHealth({ template: "cleaner", finalReportSubmitted: false });
  assert.equal(s.bloqueado, true);
  assert.equal(s.pendencias[0].chave, "final");
  assert.ok(s.nota < 30);
});

test("certificado não tem seção de chegada, e não se cobra foto de antes", () => {
  const s = reportHealth({
    template: "certificate",
    finalReportSubmitted: true,
    finalReport: { photos: ["cert.pdf"], inspection_summary: "EICR carried out, no C1 or C2 observed." },
    timerStartedAt: "x",
    timerEndedAt: "y",
  });
  assert.ok(!s.itens.some((i) => i.chave === "fotos_antes"));
  assert.equal(s.bloqueado, false);
});

test("nota alta nunca convive com item bloqueante", () => {
  // A regra que protege quem confia na nota: se bloqueia, a faixa diz bloqueado
  // por mais alta que a nota esteja.
  const s = reportHealth({ ...limpezaOk, finalReport: { photos: {} } });
  assert.equal(faixaDaNota(s), "bloqueado");
});
