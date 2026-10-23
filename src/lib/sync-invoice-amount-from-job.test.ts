import { test } from "node:test";
import assert from "node:assert/strict";
import type { Invoice, Job } from "@/types/database";
import { faturasDoJobQueContam, linkedInvoiceTargetAmount } from "./sync-invoice-amount-from-job";

// JOB-9710: £180, sinal de 50% na criação → cronograma 90 / 90.
const job = {
  id: "j1",
  reference: "JOB-9710",
  client_price: 180,
  extras_amount: 0,
  customer_deposit: 90,
  customer_final_payment: 90,
} as unknown as Job;

function fatura(kind: Invoice["invoice_kind"], amount = 180): Invoice {
  return { id: "i1", amount, amount_paid: 90, status: "partially_paid", invoice_kind: kind } as unknown as Invoice;
}

test("fatura única do job nunca encolhe para a fatia do sinal, qualquer que seja o kind", () => {
  for (const kind of ["final", "deposit", "combined", "other"] as const) {
    assert.equal(linkedInvoiceTargetAmount(job, fatura(kind), { faturaUnicaDoJob: true }), 180, kind);
  }
});

test("fatura única já encolhida volta ao total do job", () => {
  assert.equal(linkedInvoiceTargetAmount(job, fatura("final", 90), { faturaUnicaDoJob: true }), 180);
});

test("sinal e saldo em faturas separadas (quote aceito) seguem cada uma com a sua fatia", () => {
  assert.equal(linkedInvoiceTargetAmount(job, fatura("deposit", 90)), 90);
  assert.equal(linkedInvoiceTargetAmount(job, fatura("final", 90)), 90);
});

test("conta só as faturas que dividem o total do job", () => {
  assert.equal(
    faturasDoJobQueContam([
      { status: "partially_paid", invoice_kind: "final" },
      { status: "cancelled", invoice_kind: "deposit" },
      { status: "pending", invoice_kind: "weekly_batch" },
    ]),
    1,
  );
});

test("job por hora com a fatura única em £0: o alvo é o total do job (JOB-9754)", async () => {
  const { linkedInvoiceTargetAmount } = await import("./invoice-target-amount");
  const job = { client_price: 144, extras_amount: 0, customer_deposit: 72, customer_final_payment: 72, job_type: "hourly", status: "awaiting_payment" } as never;
  const inv = { amount: 0, status: "paid", invoice_kind: "final" } as never;
  assert.equal(linkedInvoiceTargetAmount(job, inv, { faturaUnicaDoJob: true }), 144);
});
