/**
 * Copy 10, 11 e 12 (fatura, recibo, final com fatura). O módulo importa "server-only":
 *   NODE_PATH=$PWD/scratchpad/stubs npx tsx --test src/lib/invoice-client-email-template.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Invoice } from "@/types/database";
import { buildInvoiceClientEmail } from "./invoice-client-email-template";

const SAMPLE: Array<[string, string]> = [["Account name", "SAMPLE ONLY"], ["Sort code", "00-00-00"]];

function inv(over: Partial<Record<string, unknown>> = {}): Invoice {
  return {
    id: "i1",
    reference: "RCP-2026-999",
    status: "pending",
    amount: 180,
    amount_paid: 0,
    due_date: "2026-10-21",
    created_at: "2026-10-14T10:00:00Z",
    job_reference: "JOB-9800",
    stripe_payment_link_url: "https://app.getfixfy.com/pay/INV-2026-999",
    ...over,
  } as unknown as Invoice;
}
const job = { client_price: 180, extras_amount: 0, commission: 30, partner_agreed_value: 120, partner_cost: 0, materials_cost: 0 };
const ctx = { clientName: "Sarah Jones", jobTitle: "Handyman visit, 2 hours", propertyAddress: "12 Example Road, London", postcode: "E1 6AN", serviceType: "Handyman visit, 2 hours", jobReference: "JOB-9800" };

function limpo(e: { subject: string; html: string; text: string }) {
  const all = e.subject + e.html + e.text;
  assert.doesNotMatch(all, /[–—]/, "no em/en dash");
  assert.doesNotMatch(all, /\{\{/, "no placeholders");
  assert.doesNotMatch(e.text + e.subject, /RCP-/, "one normalised reference");
  assert.doesNotMatch(all, /JOB COMPLETED/);
}

describe("copy 10: invoice", () => {
  it("subject, greeting, amount and due date, one CTA, transfer module", () => {
    const e = buildInvoiceClientEmail(inv(), ctx, job, { bankRows: SAMPLE, documentAttached: true });
    limpo(e);
    assert.equal(e.subject, "Your invoice INV-2026-999 is ready");
    assert.match(e.text, /^PAYMENT DUE\nYour invoice is ready/);
    assert.match(e.text, /Hi Sarah,/);
    assert.match(e.text, /Please pay £180\.00 by Wednesday 21 October 2026/);
    assert.match(e.text, /Prefer a bank transfer\? Use the details below and quote INV-2026-999\./);
    assert.match(e.text, /Need a VAT invoice\?/);
    assert.match(e.text, /Payment breakdown: Trade services/);
    assert.equal((e.html.match(/>Pay £180\.00</g) ?? []).length, 1);
  });
  it("B2B account greets the company", () => {
    const e = buildInvoiceClientEmail(inv(), { ...ctx, clientName: "Jane Contact", companyName: "Acme Lettings", billingMode: "account" }, job, { bankRows: SAMPLE });
    assert.match(e.text, /Hi Acme Lettings team,/);
    assert.doesNotMatch(e.text, /Jane/);
  });
  it("B2B without company name never uses the contact person", () => {
    const e = buildInvoiceClientEmail(inv(), { ...ctx, clientName: "Jane Contact", companyName: null, billingMode: "account" }, job, { bankRows: SAMPLE });
    assert.match(e.text, /Hi team,/);
    assert.doesNotMatch(e.text, /Hi Jane/);
  });
  it("no bank details: no transfer module", () => {
    const e = buildInvoiceClientEmail(inv(), ctx, job, { bankRows: [] });
    assert.doesNotMatch(e.text, /Prefer a bank transfer/);
  });
  it("agent model is a statement, with the professional disclosures", () => {
    const e = buildInvoiceClientEmail(inv(), ctx, job, { bankRows: SAMPLE, agentParty: { professionalName: "TM Handyman Ltd", businessAddress: "1 Trade St, London", vatNumber: null } });
    limpo(e);
    assert.equal(e.subject, "Your statement INV-2026-999 is ready");
    assert.match(e.text, /TM Handyman Ltd/);
    assert.match(e.text, /as agent for/);
    assert.doesNotMatch(e.text, /VAT invoice/);
  });
});

describe("copy 11: receipt", () => {
  it("deposit: amount received and remaining balance, no completed-work claim", () => {
    const e = buildInvoiceClientEmail(
      inv({ status: "paid", amount: 90, amount_paid: 90, invoice_kind: "deposit", stripe_paid_at: "2026-10-20T09:00:00Z" }),
      ctx,
      job,
      { bankRows: SAMPLE, documentAttached: true },
    );
    limpo(e);
    assert.equal(e.subject, "Payment received · INV-2026-999");
    assert.match(e.text, /We’ve received £90\.00 for Handyman visit, 2 hours\. Your receipt is attached/);
    assert.match(e.text, /Your remaining balance is £90\.00, due on completion of the work\./);
    assert.match(e.text, /Payment method: Card/);
    assert.doesNotMatch(e.text, /Prefer a bank transfer|complete\b/);
  });
  it("fully paid without attachment says nothing about attached", () => {
    const e = buildInvoiceClientEmail(inv({ status: "paid", amount_paid: 180 }), ctx, job, { bankRows: SAMPLE });
    assert.match(e.text, /There is no remaining balance on this invoice\./);
    assert.doesNotMatch(e.text, /attached/);
  });
});

describe("copy 12: final email with invoice", () => {
  it("unpaid: report attached, invoice included, balance and due date", () => {
    const e = buildInvoiceClientEmail(inv(), ctx, job, { final: true, reportAttachmentCount: 1, documentAttached: true, bankRows: SAMPLE });
    limpo(e);
    assert.equal(e.subject, "Your job report and invoice · JOB-9800");
    assert.match(e.text, /Your work is complete/);
    assert.match(e.text, /your final report is attached/);
    assert.match(e.text, /Your invoice is also included\. The remaining amount to pay is £180\.00, due by Wednesday 21 October 2026\./);
  });
  it("paid: no pay button, receipt line", () => {
    const e = buildInvoiceClientEmail(inv({ status: "paid", amount_paid: 180 }), ctx, job, { final: true, reportAttachmentCount: 2, documentAttached: true, bankRows: SAMPLE });
    assert.match(e.text, /Your payment receipt is also attached\. Thank you for your payment\./);
    assert.doesNotMatch(e.text, /Pay £|Prefer a bank transfer/);
  });
  it("report missing: never says attached", () => {
    const e = buildInvoiceClientEmail(inv(), ctx, job, { final: true, reportAttachmentCount: 0, missingReportNote: "x", documentAttached: false, bankRows: SAMPLE });
    assert.doesNotMatch(e.text, /attached for|is attached|also included/);
    assert.match(e.text, /couldn’t attach the report/);
  });
});
