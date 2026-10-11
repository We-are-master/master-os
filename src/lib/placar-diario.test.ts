import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { entreguesNaJanela, escolherAcoes, somarDias, STATUS_ABERTO } from "./placar-diario";

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
  it("picks the 3 most urgent actions, a job with no partner in 2 days first", () => {
    const a = escolherAcoes({
      semParceiroUrgente: { n: 1, proximo: "Tue 13 Oct", refs: ["JOB-9699"] },
      semParceiroDepois: 2,
      clientesEsperando: 9,
      finalCheck: { n: 4, valor: 2100 },
      quotesProntas: { n: 10, valor: 5400 },
      vencidas: { n: 3, valor: 1061 },
      contasPendentes: 1,
    });
    assert.deepEqual(a.map((x) => x.chave), ["assign_now", "reply", "final_check"]);
    assert.match(a[0].titulo, /1 job happening/);
    assert.match(a[0].detalhe, /JOB-9699 · first one on Tue 13 Oct/);
  });
  it("skips what is empty and copes with Zendesk being unreachable", () => {
    const a = escolherAcoes({ semParceiroUrgente: { n: 0, proximo: null, refs: [] }, semParceiroDepois: 0, clientesEsperando: null, finalCheck: { n: 0, valor: 0 }, quotesProntas: { n: 2, valor: 800 }, vencidas: { n: 0, valor: 0 }, contasPendentes: 0 });
    assert.deepEqual(a.map((x) => x.chave), ["send_quotes"]);
    assert.equal(escolherAcoes({ semParceiroUrgente: { n: 0, proximo: null, refs: [] }, semParceiroDepois: 0, clientesEsperando: 0, finalCheck: { n: 0, valor: 0 }, quotesProntas: { n: 0, valor: 0 }, vencidas: { n: 0, valor: 0 }, contasPendentes: 0 }).length, 0);
  });
});
