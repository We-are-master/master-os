import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildBidNotesJson,
  parseBidProposalFromNotes,
  validatePartnerBidPayload,
} from "./quote-bid-payload";

const validPayload = {
  labour_cost: 100,
  materials_cost: 50,
  labour_pricing: "fixed" as const,
  materials_pricing: "unit" as const,
  start_date_option_1: "2026-07-01",
  start_date_option_2: "2026-07-08",
};

describe("validatePartnerBidPayload", () => {
  it("accepts a complete fixed bid", () => {
    const r = validatePartnerBidPayload(validPayload, 150);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.payload.labour_cost, 100);
      assert.equal(r.payload.start_date_option_1, "2026-07-01");
    }
  });

  it("rejects missing start dates", () => {
    const r = validatePartnerBidPayload({ ...validPayload, start_date_option_2: "" }, 150);
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.errors.some((e) => e.includes("option 2")));
  });

  it("rejects identical start dates", () => {
    const r = validatePartnerBidPayload(
      { ...validPayload, start_date_option_2: "2026-07-01" },
      150,
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.errors.some((e) => e.includes("different")));
  });

  it("requires hourly fields when labour is hourly", () => {
    const r = validatePartnerBidPayload(
      { ...validPayload, labour_pricing: "hourly", labour_hours: undefined, labour_rate: undefined },
      150,
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.errors.some((e) => e.includes("hours")));
      assert.ok(r.errors.some((e) => e.includes("rate")));
    }
  });

  it("rejects bid total mismatch", () => {
    const r = validatePartnerBidPayload(validPayload, 200);
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.errors.some((e) => e.includes("labour + materials")));
  });

  it("allows materials cost of zero", () => {
    const r = validatePartnerBidPayload(
      { ...validPayload, materials_cost: 0 },
      100,
    );
    assert.equal(r.ok, true);
  });
});

describe("buildBidNotesJson", () => {
  it("round-trips through parseBidProposalFromNotes", () => {
    const notes = buildBidNotesJson(validPayload, "Access via rear gate");
    const parsed = parseBidProposalFromNotes(notes);
    assert.equal(parsed?.labour_cost, 100);
    assert.equal(parsed?.materials_cost, 50);
    assert.equal(parsed?.start_date_option_1, "2026-07-01");
    assert.ok(notes.includes("Access via rear gate"));
  });
});
