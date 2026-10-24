import { test } from "node:test";
import assert from "node:assert/strict";
import type { Invoice } from "@/types/database";
import { faturaUnicaDoJob, pagoNaFaturaUnica } from "./fatura-unica-pagamentos";

const fatura = (id: string, extra: Partial<Invoice> = {}) =>
  ({ id, status: "partially_paid", invoice_kind: "combined", ...extra }) as Pick<Invoice, "id" | "status" | "invoice_kind">;

test("fatura única: uma só que conta, ignorando cancelada e semanal", () => {
  assert.equal(faturaUnicaDoJob([fatura("a")])?.id, "a");
  assert.equal(faturaUnicaDoJob([fatura("a"), fatura("b", { status: "cancelled" })])?.id, "a");
  assert.equal(faturaUnicaDoJob([fatura("a"), fatura("w", { invoice_kind: "weekly_batch" })])?.id, "a");
});

test("sinal e saldo em faturas separadas não têm fatura única", () => {
  assert.equal(faturaUnicaDoJob([fatura("dep", { invoice_kind: "deposit" }), fatura("fin", { invoice_kind: "final" })]), null);
  assert.equal(faturaUnicaDoJob([]), null);
});

test("JOB-9708: pagamentos sem vínculo entram na fatura única junto com os vinculados", () => {
  const pagos = [
    { type: "customer_deposit", amount: 2200, linked_invoice_id: "inv" },
    { type: "customer_final", amount: 15, linked_invoice_id: "inv" },
    { type: "customer_final", amount: 21, linked_invoice_id: "inv" },
    { type: "customer_final", amount: 1650, linked_invoice_id: null },
    { type: "customer_final", amount: "287.33", linked_invoice_id: null },
    { type: "customer_final", amount: 54.28 },
    { type: "customer_final", amount: 15.11, linked_invoice_id: null },
    { type: "customer_final", amount: 110.56, linked_invoice_id: null },
    { type: "partner", amount: 1787, linked_invoice_id: null },
  ];
  assert.equal(pagoNaFaturaUnica(pagos, "inv"), 4353.28);
});

test("pagamento vinculado a outra fatura não conta", () => {
  const pagos = [
    { type: "customer_final", amount: 100, linked_invoice_id: "inv" },
    { type: "customer_final", amount: 40, linked_invoice_id: "outra" },
    { type: "customer_final", amount: 10, linked_invoice_id: null },
  ];
  assert.equal(pagoNaFaturaUnica(pagos, "inv"), 110);
});
