import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ehB2B, motivoDeDesistencia, proximoPasso, textoDaCobranca } from "./followup-quotes";

describe("quote chase: three follow-ups in seven days, then close", () => {
  it("first chase 24h after the quote", () => {
    assert.equal(proximoPasso([], 23), null);
    assert.equal(proximoPasso([], 24), 1);
  });
  it("second and third 48h apart (day 3 and day 5)", () => {
    assert.equal(proximoPasso(["quote_chase_1"], 47), null);
    assert.equal(proximoPasso(["quote_chase_1"], 48), 2);
    assert.equal(proximoPasso(["quote_chase_1", "quote_chase_2"], 48), 3);
  });
  it("closes 48h after the third (day 7)", () => {
    assert.equal(proximoPasso(["quote_chase_1", "quote_chase_2", "quote_chase_3"], 47), null);
    assert.equal(proximoPasso(["quote_chase_1", "quote_chase_2", "quote_chase_3"], 48), "fechar");
  });
  it("closed tickets are left alone", () => {
    assert.equal(proximoPasso(["quote_closed_no_reply"], 500), null);
    assert.equal(proximoPasso(["quote_closed_by_customer"], 500), null);
  });
  it("B2B is recognised by the b2b tag", () => {
    assert.equal(ehB2B({ tags: ["b2b", "quote_chase_1"] }), true);
    assert.equal(ehB2B({ tags: ["harvey_wa"] }), false);
  });
  it("a customer who no longer needs it closes the quote with the right reason", () => {
    assert.equal(motivoDeDesistencia("Hi, we found someone else, thanks"), "booked_elsewhere");
    assert.equal(motivoDeDesistencia("It's too expensive for us at the moment"), "too_expensive");
    assert.equal(motivoDeDesistencia("We no longer need this, thank you"), "customer_cancelled");
    assert.equal(motivoDeDesistencia("Please cancel it, we're all sorted"), "customer_cancelled");
  });
  it("anything else stays with the team", () => {
    assert.equal(motivoDeDesistencia("Can you do Thursday?"), null);
    assert.equal(motivoDeDesistencia("Is the price including materials?"), null);
    assert.equal(motivoDeDesistencia("yes please go ahead"), null);
  });
  it("copy has no dashes, B2B and B2C", () => {
    for (const p of [1, 2, 3] as const) {
      assert.doesNotMatch(textoDaCobranca(p, "Tony") + textoDaCobranca(p, "Tony", true), /—/);
    }
  });
});
