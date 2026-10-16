import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decidirDesconto } from "./desconto";

describe("Harvey discount: up to 5%, margin never below 30%", () => {
  it("half day handyman £180 vs £117 partner: 5% keeps 31.6%", () => {
    const d = decidirDesconto(180, 117);
    assert.equal(d.ok, true);
    if (d.ok) { assert.equal(d.percent, 5); assert.equal(d.novoTotal, 171); }
  });
  it("gives less than 5% when 5% would break the floor", () => {
    const d = decidirDesconto(200, 136); // 32% now
    assert.equal(d.ok, true);
    if (d.ok) assert.equal(d.percent, 2);
  });
  it("no discount when margin is already under 30% (deep clean)", () => {
    const d = decidirDesconto(194, 145);
    assert.deepEqual(d.ok, false);
  });
  it("no discount without the partner cost", () => {
    assert.equal(decidirDesconto(180, null).ok, false);
  });
});
