import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideApiChargeOnCreate, parseChargeOnCreate } from "./charge-on-create";

describe("parseChargeOnCreate", () => {
  it("ausente, null e vazio: a conta decide", () => {
    assert.deepEqual(parseChargeOnCreate(undefined), { kind: "absent" });
    assert.deepEqual(parseChargeOnCreate(null), { kind: "absent" });
    assert.deepEqual(parseChargeOnCreate(""), { kind: "absent" });
    assert.deepEqual(parseChargeOnCreate("   "), { kind: "absent" });
  });

  it("on_completion, 0 e false: pedido explícito de não cobrar", () => {
    for (const v of ["on_completion", "charge_on_completion", "Charge on completion", "none", "0", 0, false, "charge_0"]) {
      assert.deepEqual(parseChargeOnCreate(v), { kind: "none" }, String(v));
    }
  });

  it("total", () => {
    for (const v of ["full", "charge_full", "FULL", "total", 100, "100", "100%"]) {
      assert.deepEqual(parseChargeOnCreate(v), { kind: "charge", percent: 100 }, String(v));
    }
  });

  it("porcentagem como número, texto ou tag do Zendesk", () => {
    assert.deepEqual(parseChargeOnCreate(50), { kind: "charge", percent: 50 });
    assert.deepEqual(parseChargeOnCreate(33.4), { kind: "charge", percent: 33 });
    assert.deepEqual(parseChargeOnCreate("50"), { kind: "charge", percent: 50 });
    assert.deepEqual(parseChargeOnCreate("25%"), { kind: "charge", percent: 25 });
    assert.deepEqual(parseChargeOnCreate("deposit_50"), { kind: "charge", percent: 50 });
    assert.deepEqual(parseChargeOnCreate("charge_50"), { kind: "charge", percent: 50 });
    assert.deepEqual(parseChargeOnCreate("charge_deposit_30"), { kind: "charge", percent: 30 });
    assert.deepEqual(parseChargeOnCreate("deposit"), { kind: "charge", percent: 50 });
  });

  it("fora da faixa ou lixo é invalid", () => {
    for (const v of [150, -5, "101", "abc", "deposit_", true, {}]) {
      assert.equal(parseChargeOnCreate(v).kind, "invalid", String(v));
    }
  });
});

describe("decideApiChargeOnCreate", () => {
  const cartao = { company_name: "Fixfy", collection_mode: "card_upfront", email_include_invoice_on_final: true };
  const fatura = { company_name: "Li & Fung", collection_mode: "invoice", email_include_invoice_on_final: true };
  const plataforma = { company_name: "Housekeep", collection_mode: "invoice", email_include_invoice_on_final: false };
  const absent = parseChargeOnCreate(undefined);

  it("sem pedido: Card upfront e cliente sem conta levam 50%", () => {
    assert.deepEqual(decideApiChargeOnCreate({ request: absent, account: cartao, paidAtBooking: null }), {
      charge: true, percent: 50, source: "account_default",
    });
    assert.deepEqual(decideApiChargeOnCreate({ request: absent, account: null, paidAtBooking: null }), {
      charge: true, percent: 50, source: "account_default",
    });
  });

  it("sem pedido: conta invoice (ou sem modo) não leva nada, sem motivo", () => {
    assert.deepEqual(decideApiChargeOnCreate({ request: absent, account: fatura, paidAtBooking: null }), {
      charge: false, requested: false, reason: null,
    });
    const semModo = { company_name: "X", email_include_invoice_on_final: true };
    assert.equal(decideApiChargeOnCreate({ request: absent, account: semModo, paidAtBooking: null }).charge, false);
  });

  it("on_completion explícito vale até para Card upfront", () => {
    const d = decideApiChargeOnCreate({ request: parseChargeOnCreate("on_completion"), account: cartao, paidAtBooking: null });
    assert.deepEqual(d, { charge: false, requested: true, reason: null });
  });

  it("pedido explícito vale para conta invoice", () => {
    const d = decideApiChargeOnCreate({ request: parseChargeOnCreate("charge_full"), account: fatura, paidAtBooking: null });
    assert.deepEqual(d, { charge: true, percent: 100, source: "requested" });
  });

  it("plataforma nunca: sem pedido fica calada, com pedido diz o motivo", () => {
    const calada = decideApiChargeOnCreate({ request: absent, account: plataforma, paidAtBooking: null });
    assert.deepEqual(calada, { charge: false, requested: false, reason: null });
    const pedida = decideApiChargeOnCreate({ request: parseChargeOnCreate(50), account: plataforma, paidAtBooking: null });
    assert.equal(pedida.charge, false);
    assert.match(pedida.charge ? "" : pedida.reason ?? "", /Housekeep does not receive invoices/);
  });

  it("pago no ato não recebe cobrança", () => {
    assert.equal(decideApiChargeOnCreate({ request: absent, account: cartao, paidAtBooking: "paid" }).charge, false);
    const d = decideApiChargeOnCreate({ request: parseChargeOnCreate("full"), account: null, paidAtBooking: "partial" });
    assert.equal(d.charge, false);
    assert.match(d.charge ? "" : d.reason ?? "", /part paid at booking/);
  });

  it("valor inválido não cobra e explica", () => {
    const d = decideApiChargeOnCreate({ request: parseChargeOnCreate("charge_lots"), account: cartao, paidAtBooking: null });
    assert.equal(d.charge, false);
    assert.match(d.charge ? "" : d.reason ?? "", /not valid/);
  });
});
