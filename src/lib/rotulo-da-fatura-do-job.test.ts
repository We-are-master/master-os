import { test } from "node:test";
import assert from "node:assert/strict";
import { rotuloDaFaturaDoJob } from "./rotulo-da-fatura-do-job";

test("sinal e saldo de cotação aceita dizem o que são (JOB-9773)", () => {
  const ctx = { temSinal: true, percentualDoSinal: 50, statusDoJob: "unassigned" };
  assert.deepEqual(rotuloDaFaturaDoJob({ invoice_kind: "deposit", status: "draft" }, ctx), { nome: "Deposit 50%", vencimento: "Due now" });
  assert.deepEqual(rotuloDaFaturaDoJob({ invoice_kind: "final", status: "draft" }, ctx), { nome: "Balance", vencimento: "After the job" });
});

test("depois do final check o saldo volta a mostrar a data", () => {
  assert.deepEqual(rotuloDaFaturaDoJob({ invoice_kind: "final", status: "pending" }, { temSinal: true, statusDoJob: "awaiting_payment" }), { nome: "Balance", vencimento: null });
});

test("pagas dizem Paid", () => {
  assert.equal(rotuloDaFaturaDoJob({ invoice_kind: "deposit", status: "paid" }, { temSinal: true }).vencimento, "Paid");
});

test("job sem sinal: fatura comum, sem rótulo", () => {
  assert.deepEqual(rotuloDaFaturaDoJob({ invoice_kind: "final", status: "pending" }, { temSinal: false }), { nome: null, vencimento: null });
});
