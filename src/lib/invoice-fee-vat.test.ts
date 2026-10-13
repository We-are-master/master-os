import { test } from "node:test";
import assert from "node:assert/strict";
import { addressLines, splitFeeVat } from "./invoice-fee-vat";

test("a taxa de £200 abre em £166,67 + £33,33 e o total não muda", () => {
  const { net, vat } = splitFeeVat(200);
  assert.equal(net, 166.67);
  assert.equal(vat, 33.33);
  assert.equal(Math.round((net + vat) * 100) / 100, 200);
});

test("bate com a fatura antiga do Xero (INV-3396: comissão £96,98 = £80,82 + £16,16)", () => {
  assert.deepEqual(splitFeeVat(96.98), { net: 80.82, vat: 16.16 });
});

test("líquido e VAT sempre somam a taxa, centavo por centavo", () => {
  for (const fee of [0.01, 1, 33.33, 99.99, 123.45, 380, 4080]) {
    const { net, vat } = splitFeeVat(fee);
    assert.equal(Math.round((net + vat) * 100), Math.round(fee * 100), `taxa ${fee}`);
  }
});

test("taxa zero ou negativa não gera VAT", () => {
  assert.deepEqual(splitFeeVat(0), { net: 0, vat: 0 });
  assert.deepEqual(splitFeeVat(-5), { net: 0, vat: 0 });
});

test("o endereço da conta vira linhas", () => {
  assert.deepEqual(addressLines("10 Shepherdess Walk, London, N1 7LB"), ["10 Shepherdess Walk", "London", "N1 7LB"]);
  assert.deepEqual(addressLines(null), []);
});
