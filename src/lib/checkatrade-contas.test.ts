import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { contaDasNotas, contaValida, rotuloDaConta } from "./checkatrade-contas";

describe("checkatrade accounts", () => {
  it("no stamp means the main account", () => {
    assert.equal(contaDasNotas("checkatrade-lead:abc123\n\nEnquiry · Plumbing"), "main");
    assert.equal(contaDasNotas(null), "main");
  });
  it("reads the stamp, and the latest one wins on accumulated notes", () => {
    assert.equal(contaDasNotas("checkatrade-lead:abc\ncheckatrade-account:second\nEnquiry"), "second");
    assert.equal(contaDasNotas("checkatrade-account:second\n...\ncheckatrade-account:main"), "main");
  });
  it("rejects odd account names", () => {
    assert.equal(contaValida("Second"), "second");
    assert.equal(contaValida("a b; drop"), null);
    assert.equal(rotuloDaConta("second"), "Checkatrade account: second");
  });
});
