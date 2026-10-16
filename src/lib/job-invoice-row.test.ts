import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildJobInvoiceRow, jobInvoiceTotal, weeklyInvoiceSkipReason } from "./job-invoice-row";

describe("buildJobInvoiceRow", () => {
  it("tem o formato da RCP-2026-935 inserida à mão", () => {
    const row = buildJobInvoiceRow({
      reference: "RCP-2026-935",
      jobReference: "JOB-9730",
      clientName: " Jane Doe ",
      amount: 223.456,
      dueDate: "2026-10-20",
      sourceAccountId: "acc-1",
    });
    assert.equal(row.reference, "RCP-2026-935");
    assert.equal(row.job_reference, "JOB-9730");
    assert.equal(row.client_name, "Jane Doe");
    assert.equal(row.amount, 223.46);
    assert.equal(row.status, "draft");
    assert.equal(row.due_date, "2026-10-20");
    assert.equal(row.invoice_kind, "final");
    assert.equal(row.collection_stage, "awaiting_final");
    assert.equal(row.collection_stage_locked, false);
    assert.equal(row.amount_paid, 0);
    assert.equal(row.source_account_id, "acc-1");
    assert.match(row.stripe_payment_link_url, /\/pay\/INV-2026-935$/);
  });

  it("sem conta não grava source_account_id; nome vazio vira Client; valor nunca negativo", () => {
    const row = buildJobInvoiceRow({ reference: "RCP-1", jobReference: "JOB-1", clientName: "", amount: -5, dueDate: "2026-10-20", sourceAccountId: null });
    assert.equal("source_account_id" in row, false);
    assert.equal(row.client_name, "Client");
    assert.equal(row.amount, 0);
  });
});

describe("jobInvoiceTotal", () => {
  it("preço + extras − promoção", () => {
    assert.equal(jobInvoiceTotal({ client_price: 200, extras_amount: 30, promotion_amount: 20, customer_deposit: 0, customer_final_payment: 0 }), 210);
  });
  it("usa sinal + final quando maior", () => {
    assert.equal(jobInvoiceTotal({ client_price: 100, extras_amount: 0, promotion_amount: 0, customer_deposit: 60, customer_final_payment: 60 }), 120);
  });
  it("hourly sem preço ainda = 0", () => {
    assert.equal(jobInvoiceTotal({ client_price: 0, extras_amount: 0, promotion_amount: 0, customer_deposit: 0, customer_final_payment: 0 }), 0);
  });
});

describe("weeklyInvoiceSkipReason", () => {
  it("conta semanal não ganha fatura por job", () => {
    assert.match(weeklyInvoiceSkipReason("Every 7 days", "Acme") ?? "", /Acme is billed in one weekly invoice/);
    assert.ok(weeklyInvoiceSkipReason("Every Friday", null));
  });
  it("Net 30, Due on Receipt e quinzenal seguem normais", () => {
    assert.equal(weeklyInvoiceSkipReason("Net 30", "Acme"), null);
    assert.equal(weeklyInvoiceSkipReason("Due on Receipt", "Acme"), null);
    assert.equal(weeklyInvoiceSkipReason("Every 2 weeks on Friday", "Acme"), null);
    assert.equal(weeklyInvoiceSkipReason(null, "Acme"), null);
  });
});
