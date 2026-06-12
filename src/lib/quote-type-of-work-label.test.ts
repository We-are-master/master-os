import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveQuoteTypeOfWorkLabel } from "./quote-type-of-work-label";

describe("resolveQuoteTypeOfWorkLabel", () => {
  it("prefers service_type over ticket-style title", () => {
    assert.equal(
      resolveQuoteTypeOfWorkLabel({
        service_type: "General Maintenance",
        title: "New Quote (test Victor e Carlos)",
      }),
      "General Maintenance",
    );
  });

  it("falls back to title when service_type is empty", () => {
    assert.equal(
      resolveQuoteTypeOfWorkLabel({
        service_type: "",
        title: "Bathroom refit",
      }),
      "Bathroom refit",
    );
  });

  it('returns "Quote" when both fields are empty', () => {
    assert.equal(resolveQuoteTypeOfWorkLabel({ service_type: null, title: null }), "Quote");
    assert.equal(resolveQuoteTypeOfWorkLabel({ service_type: "  ", title: "" }), "Quote");
  });
});
