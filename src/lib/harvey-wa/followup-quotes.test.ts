import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estagioDaCobranca, textoDaCobranca } from "./followup-quotes";

describe("quote chase: 24h then 72h, then the team decides", () => {
  it("first chase after 24h", () => {
    assert.equal(estagioDaCobranca([], 23), null);
    assert.equal(estagioDaCobranca([], 24), 1);
  });
  it("second chase 48h after the first (72h after the quote)", () => {
    assert.equal(estagioDaCobranca(["quote_chase_1"], 47), null);
    assert.equal(estagioDaCobranca(["quote_chase_1"], 48), 2);
  });
  it("never a third", () => {
    assert.equal(estagioDaCobranca(["quote_chase_1", "quote_chase_2"], 500), null);
  });
  it("copy has no dashes", () => {
    assert.doesNotMatch(textoDaCobranca(1, "Tony") + textoDaCobranca(2, "Tony"), /—/);
  });
});
