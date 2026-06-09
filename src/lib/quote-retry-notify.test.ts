import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { retryNotifyPartnersForQuote } from "./quote-retry-notify";

describe("retryNotifyPartnersForQuote", () => {
  it("rejects invalid quote id", async () => {
    const r = await retryNotifyPartnersForQuote({} as never, { quoteId: "not-a-uuid" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 400);
  });
});
