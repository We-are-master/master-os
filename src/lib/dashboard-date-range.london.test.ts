import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getBoundsForPreset, londonYmd, wallToLondonIso } from "./dashboard-date-range";

describe("Pulse dates are London dates", () => {
  it("turns a London wall clock into the real instant, summer and winter", () => {
    assert.equal(wallToLondonIso(new Date(2026, 9, 11, 0, 0, 0, 0)), "2026-10-10T23:00:00.000Z");
    assert.equal(wallToLondonIso(new Date(2026, 9, 11, 23, 59, 59, 999)), "2026-10-11T22:59:59.999Z");
    assert.equal(wallToLondonIso(new Date(2026, 11, 1, 0, 0, 0, 0)), "2026-12-01T00:00:00.000Z");
  });
  it("reads the London day of an instant", () => {
    assert.equal(londonYmd(new Date("2026-10-10T23:30:00Z")), "2026-10-11");
    assert.equal(londonYmd(new Date("2026-12-01T23:30:00Z")), "2026-12-01");
  });
  it("this month covers the whole London month whatever the machine timezone", () => {
    const b = getBoundsForPreset("mtd")!;
    assert.match(londonYmd(new Date(b.fromIso)), /-01$/);
    const fim = londonYmd(new Date(b.toIso));
    const ultimo = new Date(Date.UTC(Number(fim.slice(0, 4)), Number(fim.slice(5, 7)), 0)).getUTCDate();
    assert.equal(Number(fim.slice(8, 10)), ultimo);
  });
});
