import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { contaDaMeta, entreguesNaJanela, haQuanto, margemPct, somarDias, STATUS_ABERTO } from "./placar-diario";

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
  it("says how much is left and what each remaining day needs", () => {
    const c = contaDaMeta(11000, 71000, "2026-10-12");
    assert.equal(c.falta, 60000);
    assert.equal(c.diasRestantes, 20);
    assert.equal(c.porDiaNecessario, 3000);
    assert.equal(c.pctDaMeta, 15.5);
    assert.equal(contaDaMeta(80000, 71000, "2026-10-31").falta, 0);
  });
  it("gross margin is profit over revenue", () => {
    assert.equal(margemPct({ jobs: 2, receita: 400, margem: 160 }), 40);
    assert.equal(margemPct({ jobs: 0, receita: 0, margem: 0 }), 0);
  });
  it("waiting time reads in hours, then days", () => {
    assert.equal(haQuanto(0), "less than 1h");
    assert.equal(haQuanto(5), "5h");
    assert.equal(haQuanto(120), "5 days");
  });
});
