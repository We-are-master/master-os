import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { montarHistorico } from "./reputacao";

const job = (o: Partial<{ status: string; client_price: number; completed_date: string; on_hold_reason_preset_id: string }>) => ({
  reference: "JOB-1", status: "completed", client_price: 200, extras_amount: 0, scheduled_date: "2026-09-01", completed_date: "2026-09-01", on_hold_reason_preset_id: null, ...o,
});

describe("lead reputation", () => {
  it("no jobs yet is new", () => {
    assert.equal(montarHistorico([], [], "2026-10-11").reputacao, "new");
  });
  it("jobs done and nothing owed is good", () => {
    const h = montarHistorico([job({}), job({ client_price: 300, completed_date: "2026-10-01" })], [{ status: "paid", due_date: "2026-09-08", amount: 200, amount_paid: 200 }], "2026-10-11");
    assert.equal(h.reputacao, "good");
    assert.equal(h.jobs, 2);
    assert.equal(h.receita, 500);
    assert.equal(h.ticketMedio, 250);
    assert.equal(h.ultimoJob, "2026-10-01");
  });
  it("a recent overdue invoice or a past complaint is attention", () => {
    assert.equal(montarHistorico([job({})], [{ status: "overdue", due_date: "2026-10-05", amount: 200, amount_paid: 0 }], "2026-10-11").reputacao, "attention");
    assert.equal(montarHistorico([job({ on_hold_reason_preset_id: "complaint" })], [], "2026-10-11").reputacao, "attention");
  });
  it("an open complaint or an invoice over 14 days late is risk", () => {
    assert.equal(montarHistorico([job({ status: "on_hold", on_hold_reason_preset_id: "complaint" })], [], "2026-10-11").reputacao, "risk");
    const h = montarHistorico([job({})], [{ status: "overdue", due_date: "2026-09-07", amount: 700, amount_paid: 0 }], "2026-10-11");
    assert.equal(h.reputacao, "risk");
    assert.equal(h.maiorAtrasoDias, 34);
    assert.equal(h.valorVencido, 700);
  });
  it("cancelled jobs do not count as work done", () => {
    const h = montarHistorico([job({ status: "cancelled" })], [], "2026-10-11");
    assert.equal(h.jobs, 0);
    assert.equal(h.cancelados, 1);
    assert.equal(h.reputacao, "new");
  });
});
