import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { partnerEmailGreetingName } from "./partner-greeting-name";

describe("partnerEmailGreetingName", () => {
  it("prefers company_name over contact_name", () => {
    assert.equal(
      partnerEmailGreetingName({
        company_name: "Acme Plumbing Ltd",
        contact_name: "John Smith",
      }),
      "Acme Plumbing Ltd",
    );
  });

  it("falls back to contact_name when company is empty", () => {
    assert.equal(
      partnerEmailGreetingName({
        company_name: "  ",
        contact_name: "John Smith",
      }),
      "John Smith",
    );
  });

  it("falls back to there when both missing", () => {
    assert.equal(partnerEmailGreetingName({}), "there");
    assert.equal(
      partnerEmailGreetingName({ company_name: null, contact_name: null }),
      "there",
    );
  });
});
