import { test } from "node:test";
import assert from "node:assert/strict";
import { valorFixoDoLink, MINIMO_COBRAVEL_GBP } from "./pay-link-amount";

test("o valor pedido vale quando cabe no saldo", () => {
  const r = valorFixoDoLink(50, 200);
  assert.deepEqual(r, { ok: true, valor: 50, limitadoAoSaldo: false });
});

test("pedido acima do saldo é limitado ao saldo, e isso é dito", () => {
  // O cliente pagou parte depois do link nascer: cobra o que restou.
  const r = valorFixoDoLink(500, 120);
  assert.deepEqual(r, { ok: true, valor: 120, limitadoAoSaldo: true });
});

test("aceita o valor escrito com libra e vírgula", () => {
  assert.equal((valorFixoDoLink("£1,250.50", 5000) as { valor: number }).valor, 1250.5);
});

test("centavo, não dízima", () => {
  assert.equal((valorFixoDoLink(33.333, 100) as { valor: number }).valor, 33.33);
});

test("sem saldo aberto não há link", () => {
  assert.deepEqual(valorFixoDoLink(50, 0), { ok: false, motivo: "sem_saldo" });
  assert.deepEqual(valorFixoDoLink(50, -10), { ok: false, motivo: "sem_saldo" });
});

test("valor inválido não vira cobrança", () => {
  for (const v of [0, -5, "abc", null, undefined, ""]) {
    assert.equal(valorFixoDoLink(v, 200).ok, false, `${String(v)} deveria ser recusado`);
  }
});

test("abaixo do mínimo do cartão é recusado com o motivo certo", () => {
  assert.deepEqual(valorFixoDoLink(0.1, 200), { ok: false, motivo: "abaixo_do_minimo" });
  assert.equal(valorFixoDoLink(MINIMO_COBRAVEL_GBP, 200).ok, true);
});

test("saldo menor que o mínimo também é recusado, e não arredondado para cima", () => {
  assert.deepEqual(valorFixoDoLink(50, 0.2), { ok: false, motivo: "abaixo_do_minimo" });
});

import { invoicePayLinkForAmount, invoicePayLinkUrl } from "./pay-link-url";

test("a URL do valor fixo sai com duas casas", () => {
  const u = invoicePayLinkForAmount("RCP-1234", 50);
  assert.match(u!, /\/pay\/RCP-1234\?amount=50\.00$/);
  assert.match(invoicePayLinkForAmount("RCP-1234", 33.333)!, /amount=33\.33$/);
});

test("sem referência ou sem valor não há URL, e não uma URL quebrada", () => {
  assert.equal(invoicePayLinkForAmount("", 50), null);
  assert.equal(invoicePayLinkForAmount("RCP-1", 0), null);
  assert.equal(invoicePayLinkForAmount("RCP-1", -5), null);
  assert.equal(invoicePayLinkForAmount("RCP-1", Number.NaN), null);
});

test("o link de porcentagem continua como era", () => {
  assert.match(invoicePayLinkUrl("RCP-1234", 50), /\/pay\/RCP-1234\?pct=50$/);
  assert.match(invoicePayLinkUrl("RCP-1234"), /\/pay\/RCP-1234$/);
});
