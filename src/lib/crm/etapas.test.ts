import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanStageLabels,
  isOpenStage,
  mergeStageLabels,
  legacyStatusFromStage,
  stageForLegacyStatusChange,
  stageFromQuoteStatus,
  validateStageChange,
} from "./etapas";

test("status da quote vira etapa do lead", () => {
  assert.equal(stageFromQuoteStatus("draft"), "quoting");
  assert.equal(stageFromQuoteStatus("in_survey"), "quoting");
  assert.equal(stageFromQuoteStatus("bidding"), "quoting");
  // Parceiro cotou e falta enviar: ainda Quoting (chip Ready to send).
  assert.equal(stageFromQuoteStatus("quote_ready"), "quoting");
  assert.equal(stageFromQuoteStatus("awaiting_customer"), "quoted");
  assert.equal(stageFromQuoteStatus("awaiting_payment"), "quoted");
  assert.equal(stageFromQuoteStatus("converted_to_job"), "won");
  assert.equal(stageFromQuoteStatus("rejected"), "lost");
});

test("etapas abertas", () => {
  assert.equal(isOpenStage("new"), true);
  assert.equal(isOpenStage("qualified"), true);
  assert.equal(isOpenStage("quoted"), true);
  assert.equal(isOpenStage("won"), false);
  assert.equal(isOpenStage("lost"), false);
  assert.equal(isOpenStage(undefined), false);
});

test("status antigo segue a etapa", () => {
  assert.equal(legacyStatusFromStage("new"), "new");
  assert.equal(legacyStatusFromStage("quoting"), "interested");
});

test("interested na tela antiga não puxa lead adiantado para trás", () => {
  assert.equal(stageForLegacyStatusChange("new", "interested"), "new");
  assert.equal(stageForLegacyStatusChange("qualified", "new"), "qualified");
  assert.equal(stageForLegacyStatusChange("qualified", "new"), "qualified");
  assert.equal(stageForLegacyStatusChange("quoting", "interested"), "quoting");
  assert.equal(stageForLegacyStatusChange("won", "new"), "won");
});

test("lost exige motivo", () => {
  assert.match(validateStageChange({ from: "new", to: "lost" }) ?? "", /reason/);
  assert.equal(validateStageChange({ from: "new", to: "lost", lostReason: "price" }), null);
});

test("lost com data de volta: a data tem que ser no futuro", () => {
  const base = { from: "new" as const, to: "lost" as const, lostReason: "timing" as const, today: "2026-11-05" };
  assert.match(validateStageChange({ ...base, nurtureUntil: "2026-11-05" }) ?? "", /future/);
  assert.match(validateStageChange({ ...base, nurtureUntil: "12/11" }) ?? "", /valid/);
  assert.equal(validateStageChange({ ...base, nurtureUntil: "2026-11-12" }), null);
});

test("won só com job e won não volta", () => {
  assert.match(validateStageChange({ from: "quoted", to: "won" }) ?? "", /job/);
  assert.equal(validateStageChange({ from: "quoted", to: "won", jobId: "j1" }), null);
  assert.match(validateStageChange({ from: "won", to: "new" }) ?? "", /already a job/);
});

test("mesma etapa é permitido", () => {
  assert.equal(validateStageChange({ from: "won", to: "won" }), null);
});

test("nome de coluna renomeada: aparado, até 24 letras, vazio volta ao padrão", () => {
  assert.deepEqual(
    cleanStageLabels({ new: "  Inbox  ", quoting: "", won: "Won", bogus: "x", lost: 5, qualified: "A".repeat(40) }),
    { new: "Inbox", qualified: "A".repeat(24) },
  );
  assert.deepEqual(cleanStageLabels(null), {});
  const m = mergeStageLabels({ quoted: "Waiting customer" });
  assert.equal(m.quoted, "Waiting customer");
  assert.equal(m.new, "New lead");
});
