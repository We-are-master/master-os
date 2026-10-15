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
  assert.match(u!, /\/pay\/INV-1234\?amount=50\.00$/);
  assert.match(invoicePayLinkForAmount("RCP-1234", 33.333)!, /amount=33\.33$/);
});

test("sem referência ou sem valor não há URL, e não uma URL quebrada", () => {
  assert.equal(invoicePayLinkForAmount("", 50), null);
  assert.equal(invoicePayLinkForAmount("RCP-1", 0), null);
  assert.equal(invoicePayLinkForAmount("RCP-1", -5), null);
  assert.equal(invoicePayLinkForAmount("RCP-1", Number.NaN), null);
});

test("o link de porcentagem continua como era", () => {
  assert.match(invoicePayLinkUrl("RCP-1234", 50), /\/pay\/INV-1234\?pct=50$/);
  assert.match(invoicePayLinkUrl("RCP-1234"), /\/pay\/INV-1234$/);
});

import { saldoDoLinkDePagamento } from "./pay-link-amount";

test("RCP-2026-917: fatura com amount = sinal pago, job no dobro, o link cobra o resto", () => {
  // Job £180, sinal de 50% pago (£90) e a fatura encolhida para 90 / 90.
  const saldo = saldoDoLinkDePagamento({
    valorFatura: 90,
    pagoFatura: 90,
    totalDoJob: 180,
    pagoNoJob: 90,
    faturaUnicaDoJob: true,
  });
  assert.equal(saldo, 90);
  // ?amount segue limitado a este saldo, como antes.
  assert.deepEqual(valorFixoDoLink(90, saldo), { ok: true, valor: 90, limitadoAoSaldo: false });
  assert.deepEqual(valorFixoDoLink(500, saldo), { ok: true, valor: 90, limitadoAoSaldo: true });
});

test("fatura já marcada como paga com o total do job em aberto não vira 'pago'", () => {
  assert.equal(
    saldoDoLinkDePagamento({ valorFatura: 90, pagoFatura: 90, faturaPaga: true, totalDoJob: 180, pagoNoJob: 90, faturaUnicaDoJob: true }),
    90,
  );
});

test("o razão do job manda quando a fatura sub-registra o pago (nunca cobra duas vezes)", () => {
  assert.equal(
    saldoDoLinkDePagamento({ valorFatura: 90, pagoFatura: 0, totalDoJob: 180, pagoNoJob: 90, faturaUnicaDoJob: true }),
    90,
  );
});

test("sem razão legível vale o pago da fatura", () => {
  assert.equal(
    saldoDoLinkDePagamento({ valorFatura: 90, pagoFatura: 90, totalDoJob: 180, pagoNoJob: null, faturaUnicaDoJob: true }),
    90,
  );
});

test("job todo pago: o link continua indo para a tela de pago", () => {
  assert.equal(
    saldoDoLinkDePagamento({ valorFatura: 90, pagoFatura: 90, totalDoJob: 180, pagoNoJob: 180, faturaUnicaDoJob: true }),
    0,
  );
});

test("fatura certa: o saldo é o da fatura, como sempre foi", () => {
  assert.equal(
    saldoDoLinkDePagamento({ valorFatura: 180, pagoFatura: 90, totalDoJob: 180, pagoNoJob: 90, faturaUnicaDoJob: true }),
    90,
  );
});

test("fatura maior que o job (CCZ ainda fora do job) cobra o que a fatura diz", () => {
  assert.equal(
    saldoDoLinkDePagamento({ valorFatura: 195, pagoFatura: 0, totalDoJob: 180, pagoNoJob: 0, faturaUnicaDoJob: true }),
    195,
  );
});

test("job com fatura de sinal e de saldo separadas: cada uma cobra a sua fatia", () => {
  assert.equal(
    saldoDoLinkDePagamento({ valorFatura: 90, pagoFatura: 0, totalDoJob: 180, pagoNoJob: 0, faturaUnicaDoJob: false }),
    90,
  );
});

test("fatura legada marcada paga à mão, sem amount_paid, não é cobrada de novo", () => {
  assert.equal(
    saldoDoLinkDePagamento({ valorFatura: 180, pagoFatura: 0, faturaPaga: true, totalDoJob: 180, pagoNoJob: 0, faturaUnicaDoJob: true }),
    0,
  );
});
