import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bucketDraftQuoteRows,
  isQuoteListNew,
  isQuoteReadyToSend,
} from "./quote-list-buckets";
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

describe("isQuoteReadyToSend", () => {
  it("returns true for manual draft with route complete, value, no PDF sent", () => {
    assert.equal(
      isQuoteReadyToSend(
        draftRow({
          draft_route_completed: true,
          quote_type: "internal",
          total_value: 250,
        }) as Quote,
      ),
      true,
    );
  });

  it("returns false when total_value is zero", () => {
    assert.equal(
      isQuoteReadyToSend(
        draftRow({ draft_route_completed: true, total_value: 0 }) as Quote,
      ),
      false,
    );
  });
});

describe("isQuoteListNew", () => {
  it("includes draft with route complete and zero value (not orphaned)", () => {
    assert.equal(
      isQuoteListNew(
        draftRow({ draft_route_completed: true, total_value: 0 }) as Quote,
      ),
      true,
    );
  });

  it("excludes ready-to-send drafts", () => {
    assert.equal(
      isQuoteListNew(
        draftRow({
          draft_route_completed: true,
          total_value: 500,
        }) as Quote,
      ),
      false,
    );
  });

  it("includes routing intake (route incomplete)", () => {
    assert.equal(
      isQuoteListNew(
        draftRow({ draft_route_completed: false }) as Quote,
      ),
      true,
    );
  });
});

describe("bucketDraftQuoteRows", () => {
  it("partitions draft rows into new and ready_to_send without overlap", () => {
    const rows = [
      draftRow({ draft_route_completed: false }),
      draftRow({ draft_route_completed: true, total_value: 0 }),
      draftRow({ draft_route_completed: true, total_value: 100 }),
      draftRow({ draft_route_completed: true, quote_type: "partner", total_value: 0 }),
    ];
    const counts = bucketDraftQuoteRows(rows);
    assert.equal(counts.draft, 3);
    assert.equal(counts.ready_to_send, 1);
    assert.equal(counts.draft + counts.ready_to_send, rows.length);
  });

  it("counts route-complete drafts with null total_value as New", () => {
    const rows = [
      draftRow({ draft_route_completed: true, total_value: null as unknown as number }),
    ];
    const counts = bucketDraftQuoteRows(rows);
    assert.equal(counts.draft, 1);
    assert.equal(counts.ready_to_send, 0);
  });
});
