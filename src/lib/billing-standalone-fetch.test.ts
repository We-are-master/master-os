import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BILLING_STANDALONE_FILTER } from "@/lib/billing-standalone-filter";
import { mergeInvoicesById, mergeSelfBillsById } from "@/lib/billing-standalone-fetch";
import type { Invoice, SelfBill } from "@/types/database";

function inv(id: string, status: Invoice["status"], dueDate?: string, createdAt?: string): Invoice {
  return {
    id,
    reference: `INV-${id}`,
    status,
    amount: 100,
    due_date: dueDate ?? null,
    created_at: createdAt ?? "2026-01-01T00:00:00Z",
  } as Invoice;
}

function sb(id: string, createdAt?: string): SelfBill {
  return {
    id,
    reference: `SB-${id}`,
    status: "draft",
    created_at: createdAt ?? "2026-01-01T00:00:00Z",
  } as SelfBill;
}

describe("mergeInvoicesById", () => {
  it("dedupes by id keeping one row per invoice", () => {
    const merged = mergeInvoicesById([
      inv("a", "pending", "2026-06-01"),
      inv("a", "overdue", "2026-06-02"),
      inv("b", "paid", "2026-05-01"),
    ]);
    assert.equal(merged.length, 2);
    assert.deepEqual(merged.map((r) => r.id).sort(), ["a", "b"]);
  });

  it("sorts newest created_at first", () => {
    const merged = mergeInvoicesById([
      inv("old", "pending", undefined, "2026-01-01T00:00:00Z"),
      inv("new", "pending", undefined, "2026-06-01T00:00:00Z"),
    ]);
    assert.equal(merged[0]?.id, "new");
  });

  it("preserves open invoices from an out-of-window batch (merge contract)", () => {
    const openOutsideWindow = inv("open-1", "awaiting_payment", "2025-01-01");
    const paidInWindow = inv("paid-1", "paid", "2026-06-01");
    const merged = mergeInvoicesById([paidInWindow, openOutsideWindow]);
    assert.equal(merged.some((r) => r.id === "open-1"), true);
    assert.equal(merged.some((r) => r.id === "paid-1"), true);
  });
});

describe("mergeSelfBillsById", () => {
  it("dedupes and sorts self-bills by created_at desc", () => {
    const merged = mergeSelfBillsById([
      sb("x", "2026-01-01T00:00:00Z"),
      sb("x", "2026-02-01T00:00:00Z"),
      sb("y", "2026-03-01T00:00:00Z"),
    ]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.id, "y");
  });
});

describe("DEFAULT_BILLING_STANDALONE_FILTER", () => {
  it("defaults UI filter to All", () => {
    assert.equal(DEFAULT_BILLING_STANDALONE_FILTER.mode, "all");
  });
});
