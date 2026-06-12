import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMoneyInput } from "./parse-money-input";

describe("parseMoneyInput", () => {
  it("parses comma decimal", () => {
    assert.equal(parseMoneyInput("33,70"), 33.7);
  });

  it("parses UK thousands", () => {
    assert.equal(parseMoneyInput("1,234.50"), 1234.5);
  });

  it("parses currency prefix", () => {
    assert.equal(parseMoneyInput("£28.08"), 28.08);
  });
});
