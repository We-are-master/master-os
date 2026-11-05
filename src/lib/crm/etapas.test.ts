import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isOpenStage,
  legacyStatusFromStage,
  stageForLegacyStatusChange,
  stageFromQuoteStatus,
  validateStageChange,
} from "./etapas";

test("status da quote vira etapa do lead", () => {
  assert.equal(stageFromQuoteStatus("draft"), "quoting");
  assert.equal(stageFromQuoteStatus("in_survey"), "quoting");
  assert.equal(stageFromQuoteStatus("bidding"), "quoting");
  assert.equal(stageFromQuoteStatus("quote_ready"), "quote_sent");
  assert.equal(stageFromQuoteStatus("awaiting_customer"), "quote_sent");
  assert.equal(stageFromQuoteStatus("awaiting_payment"), "accepted");
  assert.equal(stageFromQuoteStatus("converted_to_job"), "won");
  assert.equal(stageFromQuoteStatus("rejected"), "lost");
});

test("etapas abertas", () => {
  assert.equal(isOpenStage("new"), true);
  assert.equal(isOpenStage("accepted"), true);
  assert.equal(isOpenStage("won"), false);
  assert.equal(isOpenStage("lost"), false);
  assert.equal(isOpenStage("nurture"), false);
  assert.equal(isOpenStage(undefined), false);
});

test("status antigo segue a etapa", () => {
  assert.equal(legacyStatusFromStage("new"), "new");
  assert.equal(legacyStatusFromStage("quoting"), "interested");
});

test("interested na tela antiga não puxa lead adiantado para trás", () => {
  assert.equal(stageForLegacyStatusChange("new", "interested"), "talking");
  assert.equal(stageForLegacyStatusChange("talking", "new"), "new");
  assert.equal(stageForLegacyStatusChange("quoting", "interested"), "quoting");
  assert.equal(stageForLegacyStatusChange("won", "new"), "won");
});

test("lost exige motivo", () => {
  assert.match(validateStageChange({ from: "talking", to: "lost" }) ?? "", /reason/);
  assert.equal(validateStageChange({ from: "talking", to: "lost", lostReason: "price" }), null);
});

test("nurture exige data no futuro", () => {
  assert.match(validateStageChange({ from: "talking", to: "nurture", today: "2026-11-05" }) ?? "", /date/);
  assert.match(validateStageChange({ from: "talking", to: "nurture", nurtureUntil: "2026-11-05", today: "2026-11-05" }) ?? "", /future/);
  assert.equal(validateStageChange({ from: "talking", to: "nurture", nurtureUntil: "2026-11-12", today: "2026-11-05" }), null);
});

test("won só com job e won não volta", () => {
  assert.match(validateStageChange({ from: "accepted", to: "won" }) ?? "", /job/);
  assert.equal(validateStageChange({ from: "accepted", to: "won", jobId: "j1" }), null);
  assert.match(validateStageChange({ from: "won", to: "talking" }) ?? "", /already a job/);
});

test("mesma etapa é permitido", () => {
  assert.equal(validateStageChange({ from: "won", to: "won" }), null);
});
