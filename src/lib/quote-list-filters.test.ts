import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isQuoteListNew, isQuoteReadyToSend } from "./quote-list-buckets";
import { matchesQuotesNewTabOrFilter } from "./quote-list-filters";
import type { Quote } from "@/types/database";

function draftRow(
  overrides: Partial<
    Pick<
      Quote,
      "status" | "draft_route_completed" | "quote_type" | "customer_pdf_sent_at" | "total_value"
    >
  > = {},
) {
  return {
    status: "draft" as const,
    draft_route_completed: false,
    quote_type: "internal" as const,
    customer_pdf_sent_at: null,
    total_value: 0,
    ...overrides,
  };
}

describe("matchesQuotesNewTabOrFilter vs isQuoteListNew", () => {
  const cases = [
    draftRow({ draft_route_completed: false }),
    draftRow({ draft_route_completed: true, total_value: 0 }),
    draftRow({ draft_route_completed: true, total_value: null as unknown as number }),
    draftRow({ draft_route_completed: true, total_value: 500 }),
    draftRow({ draft_route_completed: true, quote_type: "partner", total_value: 800 }),
    draftRow({ draft_route_completed: null as unknown as boolean }),
    draftRow({ draft_route_completed: true, customer_pdf_sent_at: "2026-01-01" }),
    draftRow({ draft_route_completed: true, customer_pdf_sent_at: "" }),
    { ...draftRow({ draft_route_completed: true, total_value: 100 }), status: "bidding" as const },
  ];

  for (const row of cases) {
    it(`parity for ${JSON.stringify(row)}`, () => {
      const q = row as Quote;
      assert.equal(
        matchesQuotesNewTabOrFilter(q),
        isQuoteListNew(q),
        `PostgREST OR filter and isQuoteListNew must agree`,
      );
      if (isQuoteListNew(q)) {
        assert.equal(isQuoteReadyToSend(q), false);
      }
    });
  }
});
