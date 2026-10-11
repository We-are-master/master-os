import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { acumularPorDia, diaDaVisita } from "./pulse-ceo";

describe("pulse ceo numbers", () => {
  it("accumulates by day of the month and ignores other months", () => {
    const acc = acumularPorDia([{ ymd: "2026-10-02", valor: 100 }, { ymd: "2026-10-02", valor: 50 }, { ymd: "2026-10-05", valor: 200 }, { ymd: "2026-09-30", valor: 999 }, { ymd: null, valor: 5 }], "2026-10-01", 31);
    assert.equal(acc.length, 31);
    assert.equal(acc[0], 0);
    assert.equal(acc[1], 150);
    assert.equal(acc[4], 350);
    assert.equal(acc[30], 350);
  });
  it("the visit day is the London day of the booked time", () => {
    assert.equal(diaDaVisita({ scheduled_start_at: "2026-10-12T23:30:00Z", scheduled_date: "2026-10-12" }), "2026-10-13");
    assert.equal(diaDaVisita({ scheduled_start_at: null, scheduled_date: "2026-10-14" }), "2026-10-14");
    assert.equal(diaDaVisita({ scheduled_start_at: null, scheduled_date: null }), null);
  });
});
