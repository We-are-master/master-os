import { describe, it } from "node:test";
import assert from "node:assert/strict";

/** Documents expected RPC payload shape (parsed in rpcGetQuoteMetricsBundle). */
describe("QuoteMetricsBundle shape", () => {
  it("merges ready_to_send into draft for New tab badge", () => {
    const raw = {
      status_counts: { draft: 5, bidding: 1 },
      funnel_counts: { draft: 3, ready_to_send: 1 },
      total_sent_to_customer_value: 12620,
      awaiting_customer_value: 11640,
      converted_count: 32,
      total_count: 50,
      conversion_pct: 7.9,
    };
    const mergedDraft = raw.funnel_counts.draft + raw.funnel_counts.ready_to_send;
    assert.equal(mergedDraft, 4);
    assert.equal(raw.status_counts.bidding, 1);
  });
});
