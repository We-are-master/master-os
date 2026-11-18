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

it("Sales: quem pagou, como e quando (dono, 18/11/2026)", async () => {
  const { montarVendas } = await import("./pulse-ceo");
  const jobs = [
    { id: "a", reference: "JOB-1", client_name: "Tatsuo Tsuji", status: "scheduled", client_price: 289, extras_amount: 0, created_at: "2026-11-18T15:00:00Z" },
    { id: "b", reference: "JOB-2", client_name: "Sejad", status: "scheduled", client_price: 330, extras_amount: 0, created_at: "2026-11-18T16:00:00Z" },
    { id: "c", reference: "JOB-3", client_name: null, status: "completed", client_price: 72, extras_amount: 0, created_at: "2026-11-17T10:00:00Z" },
  ];
  const v = montarVendas(
    jobs,
    [
      { job_id: "a", type: "customer_deposit", amount: 144.5, payment_method: "stripe", payment_date: "2026-11-18", created_at: null },
      { job_id: "a", type: "partner_payment", amount: 100, payment_method: "bank_transfer", payment_date: "2026-11-18", created_at: null },
    ],
    [{ job_reference: "JOB-3", amount: 72, amount_paid: 72, paid_date: "2026-11-17" }],
  );
  assert.deepEqual(v.map((x) => x.ref), ["JOB-2", "JOB-1", "JOB-3"]);
  assert.equal(v[0].pago, null);
  assert.deepEqual(v[1].pago, { valor: 144.5, como: "card", quando: "18 Nov" });
  assert.deepEqual(v[2].pago, { valor: 72, como: "marked paid", quando: "17 Nov" });
  assert.equal(v[2].cliente, "Customer");
});
