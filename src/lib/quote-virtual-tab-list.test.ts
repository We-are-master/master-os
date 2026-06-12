import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bucketDraftQuoteRows } from "./quote-list-buckets";
import {
  filterQuotesForVirtualTab,
  matchesQuoteVirtualTab,
  paginateQuoteRows,
  quoteMatchesVirtualTabSearch,
} from "./quote-virtual-tab-list";
import type { Quote } from "@/types/database";

function quote(
  overrides: Partial<Quote> & Pick<Quote, "id" | "reference" | "created_at">,
): Quote {
  return {
    status: "draft",
    draft_route_completed: false,
    quote_type: "internal",
    customer_pdf_sent_at: null,
    total_value: 0,
    title: "",
    client_name: "",
    client_email: "",
    ...overrides,
  } as Quote;
}

describe("filterQuotesForVirtualTab", () => {
  const rows = [
    quote({ id: "1", reference: "Q-001", created_at: "2026-06-01T10:00:00Z", draft_route_completed: false }),
    quote({
      id: "2",
      reference: "Q-002",
      created_at: "2026-06-02T10:00:00Z",
      draft_route_completed: true,
      total_value: 250,
    }),
    quote({
      id: "3",
      reference: "Q-003",
      created_at: "2026-06-03T10:00:00Z",
      draft_route_completed: true,
      total_value: 0,
    }),
  ];

  it("new tab matches bucketDraftQuoteRows.draft count", () => {
    const filtered = filterQuotesForVirtualTab(rows, "new");
    const counts = bucketDraftQuoteRows(rows);
    assert.equal(filtered.length, counts.draft);
    assert.deepEqual(
      filtered.map((q) => q.id),
      ["3", "1"],
    );
  });

  it("ready_to_send tab matches bucketDraftQuoteRows.ready_to_send count", () => {
    const filtered = filterQuotesForVirtualTab(rows, "ready_to_send");
    const counts = bucketDraftQuoteRows(rows);
    assert.equal(filtered.length, counts.ready_to_send);
    assert.deepEqual(filtered.map((q) => q.id), ["2"]);
  });

  it("search filters by reference", () => {
    const filtered = filterQuotesForVirtualTab(rows, "new", "q-001");
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.id, "1");
  });
});

describe("paginateQuoteRows", () => {
  const rows = [
    quote({ id: "a", reference: "A", created_at: "2026-06-01T10:00:00Z" }),
    quote({ id: "b", reference: "B", created_at: "2026-06-02T10:00:00Z" }),
    quote({ id: "c", reference: "C", created_at: "2026-06-03T10:00:00Z" }),
  ];

  it("returns correct page slice and totals", () => {
    const page1 = paginateQuoteRows(rows, 1, 2);
    assert.equal(page1.count, 3);
    assert.equal(page1.totalPages, 2);
    assert.equal(page1.data.length, 2);
    assert.deepEqual(page1.data.map((q) => q.id), ["a", "b"]);

    const page2 = paginateQuoteRows(rows, 2, 2);
    assert.equal(page2.data.length, 1);
    assert.equal(page2.data[0]?.id, "c");
  });
});

describe("quoteMatchesVirtualTabSearch", () => {
  const row = quote({
    id: "1",
    reference: "FX-100",
    created_at: "2026-06-01T10:00:00Z",
    client_name: "Acme Ltd",
    title: "Boiler repair",
  });

  it("matches client_name case-insensitively", () => {
    assert.equal(quoteMatchesVirtualTabSearch(row, "acme"), true);
    assert.equal(quoteMatchesVirtualTabSearch(row, "missing"), false);
  });
});

describe("matchesQuoteVirtualTab", () => {
  it("delegates to isQuoteListNew / isQuoteReadyToSend", () => {
    const ready = quote({
      id: "r",
      reference: "R",
      created_at: "2026-06-01T10:00:00Z",
      draft_route_completed: true,
      total_value: 100,
    });
    assert.equal(matchesQuoteVirtualTab(ready, "new"), false);
    assert.equal(matchesQuoteVirtualTab(ready, "ready_to_send"), true);
  });
});
