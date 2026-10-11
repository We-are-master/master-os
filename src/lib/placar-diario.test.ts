import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { entreguesNaJanela, somarDias, STATUS_ABERTO } from "./placar-diario";

const job = (o: Record<string, unknown>) => ({ status: "completed", client_price: 200, extras_amount: 0, partner_cost: 120, materials_cost: 0, scheduled_date: "2026-10-09", completed_date: "2026-10-09", ...o }) as never;

describe("daily scoreboard", () => {
  it("counts a job on the day it was finished, not the day it was approved", () => {
    const jobs = [job({ final_report: { submitted_at: "2026-10-08T15:00:00Z" }, completed_date: "2026-10-10" })];
    assert.equal(entreguesNaJanela(jobs, "2026-10-08", "2026-10-08").jobs, 1);
    assert.equal(entreguesNaJanela(jobs, "2026-10-10", "2026-10-10").jobs, 0);
  });
  it("cancelled, scheduled and on-hold jobs are not delivered", () => {
    const jobs = [job({ status: "cancelled" }), job({ status: "scheduled" }), job({ status: "on_hold" }), job({ status: "awaiting_payment" }), job({ status: "final_check" })];
    const j = entreguesNaJanela(jobs, "2026-10-09", "2026-10-09");
    assert.equal(j.jobs, 2);
    assert.equal(j.receita, 400);
    assert.equal(j.margem, 160);
  });
  it("open jobs never include cancelled, completed or awaiting payment (the old brief's mistake)", () => {
    for (const s of ["cancelled", "completed", "awaiting_payment", "deleted"]) assert.equal((STATUS_ABERTO as readonly string[]).includes(s), false);
  });
  it("adds days across a month end", () => {
    assert.equal(somarDias("2026-10-01", -1), "2026-09-30");
    assert.equal(somarDias("2026-10-11", -30), "2026-09-11");
  });
});
