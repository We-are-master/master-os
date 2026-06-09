import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCancellationLossHint,
  filterPulseCancelledInsightsRows,
  isPulseCancelledTestNoise,
  type PulseCancelledJobRow,
} from "./pulse-cancelled-insights";

function sampleRow(
  overrides: Partial<PulseCancelledJobRow> & Pick<PulseCancelledJobRow, "id" | "reference">,
): PulseCancelledJobRow {
  return {
    title: null,
    created_at: null,
    cancellation_reason: null,
    cancellation_reason_preset_id: null,
    cancelled_client_price: 100,
    cancelled_extras_amount: 0,
    quote_id: null,
    service_type: null,
    ...overrides,
  };
}

describe("isPulseCancelledTestNoise", () => {
  it("ignores other preset with detail test (em dash)", () => {
    assert.equal(
      isPulseCancelledTestNoise({
        cancellation_reason: "Other (add details below) — test",
        cancellation_reason_preset_id: "other",
        title: "Gardener",
        reference: "JOB-9001",
      }),
      true,
    );
  });

  it("ignores other with detail test (hyphen, no preset id)", () => {
    assert.equal(
      isPulseCancelledTestNoise({
        cancellation_reason: "other (add details below) - test",
        cancellation_reason_preset_id: null,
        title: "Gardener",
        reference: "JOB-9002",
      }),
      true,
    );
  });

  it("keeps real cancellation reasons", () => {
    assert.equal(
      isPulseCancelledTestNoise({
        cancellation_reason: "Client changed mind",
        cancellation_reason_preset_id: "client_requested",
        title: "Plumber",
        reference: "JOB-9002",
      }),
      false,
    );
  });
});

describe("filterPulseCancelledInsightsRows", () => {
  it("drops test jobs from insights", () => {
    const rows = filterPulseCancelledInsightsRows([
      sampleRow({
        id: "1",
        reference: "JOB-1",
        cancellation_reason: "Other (add details below) — test",
        cancellation_reason_preset_id: "other",
      }),
      sampleRow({
        id: "2",
        reference: "JOB-2",
        cancellation_reason_preset_id: "client_requested",
      }),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, "2");
  });
});

describe("buildCancellationLossHint", () => {
  it("handles empty rows", () => {
    const hint = buildCancellationLossHint([]);
    assert.match(hint, /^No cancellations this period/);
  });

  it("ignores test-only rows in hint", () => {
    const rows = filterPulseCancelledInsightsRows([
      sampleRow({
        id: "1",
        reference: "JOB-1",
        cancellation_reason: "other (add details below) — test",
      }),
      sampleRow({
        id: "2",
        reference: "JOB-2",
        cancellation_reason: "other (add details below) — test",
      }),
    ]);
    const hint = buildCancellationLossHint(rows);
    assert.match(hint, /^No cancellations this period/);
  });

  it("uses month prefix for dominant reason", () => {
    const rows = [
      sampleRow({
        id: "1",
        reference: "JOB-1",
        cancellation_reason_preset_id: "client_requested",
        cancelled_client_price: 50,
      }),
      sampleRow({
        id: "2",
        reference: "JOB-2",
        cancellation_reason_preset_id: "client_requested",
        cancelled_client_price: 75,
      }),
    ];
    const hint = buildCancellationLossHint(rows);
    assert.match(hint, /^This month, lost revenue is mostly from clients changing their mind/);
    assert.match(hint, /friendly confirmation the day before/);
  });

  it("includes partner coaching for partner_capacity preset", () => {
    const rows = [
      sampleRow({
        id: "1",
        reference: "JOB-1",
        cancellation_reason_preset_id: "partner_capacity",
        cancelled_client_price: 25,
      }),
    ];
    const hint = buildCancellationLossHint(rows);
    assert.match(hint, /^This month, lost revenue is mostly from not having the right partner/);
    assert.match(hint, /Invite a wider pool of partners earlier/);
  });
});
