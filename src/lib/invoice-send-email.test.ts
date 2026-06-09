import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canSendJobInvoiceEmail,
  canSendJobSelfBillEmail,
} from "./invoice-send-eligibility";
import { buildInvoiceEmailSubject, resolveInvoiceCcEmail } from "./invoice-send-email";

describe("canSendJobInvoiceEmail", () => {
  it("requires a linked invoice", () => {
    const r = canSendJobInvoiceEmail({
      invoice: null,
      jobInternalInvoiceApproved: true,
      canIncludeInvoice: true,
      documentEmail: "a@b.com",
    });
    assert.equal(r.ok, false);
  });

  it("blocks cancelled invoices", () => {
    const r = canSendJobInvoiceEmail({
      invoice: { status: "cancelled" },
      jobInternalInvoiceApproved: true,
      canIncludeInvoice: true,
      documentEmail: "a@b.com",
    });
    assert.equal(r.ok, false);
  });

  it("blocks when finance not approved on job", () => {
    const r = canSendJobInvoiceEmail({
      invoice: { status: "pending" },
      jobInternalInvoiceApproved: false,
      canIncludeInvoice: true,
      documentEmail: "a@b.com",
    });
    assert.equal(r.ok, false);
  });

  it("blocks when account disallows invoice emails", () => {
    const r = canSendJobInvoiceEmail({
      invoice: { status: "pending" },
      jobInternalInvoiceApproved: true,
      canIncludeInvoice: false,
      documentEmail: "a@b.com",
    });
    assert.equal(r.ok, false);
  });

  it("blocks when billing email missing", () => {
    const r = canSendJobInvoiceEmail({
      invoice: { status: "pending" },
      jobInternalInvoiceApproved: true,
      canIncludeInvoice: true,
      documentEmail: null,
    });
    assert.equal(r.ok, false);
  });

  it("allows when all gates pass", () => {
    const r = canSendJobInvoiceEmail({
      invoice: { status: "pending" },
      jobInternalInvoiceApproved: true,
      canIncludeInvoice: true,
      documentEmail: "finance@client.com",
    });
    assert.equal(r.ok, true);
  });
});

describe("canSendJobSelfBillEmail", () => {
  it("requires a self-bill", () => {
    assert.equal(canSendJobSelfBillEmail({ selfBill: null, partnerEmail: "p@x.com" }).ok, false);
  });

  it("blocks internal payroll bills", () => {
    const r = canSendJobSelfBillEmail({
      selfBill: { status: "awaiting_payment", bill_origin: "internal", partner_id: "pid" },
      partnerEmail: "p@x.com",
    });
    assert.equal(r.ok, false);
  });

  it("blocks without partner email", () => {
    const r = canSendJobSelfBillEmail({
      selfBill: { status: "awaiting_payment", bill_origin: "partner", partner_id: "pid" },
      partnerEmail: null,
    });
    assert.equal(r.ok, false);
  });

  it("allows partner field bill with email", () => {
    const r = canSendJobSelfBillEmail({
      selfBill: { status: "awaiting_payment", bill_origin: "partner", partner_id: "pid" },
      partnerEmail: "partner@fix.com",
    });
    assert.equal(r.ok, true);
  });
});

describe("buildInvoiceEmailSubject", () => {
  it("uses receipt wording when paid", () => {
    const s = buildInvoiceEmailSubject(
      {
        reference: "INV-1",
        status: "paid",
        amount: 100,
        amount_paid: 100,
        stripe_payment_status: "paid",
        stripe_paid_at: undefined,
      },
      "JOB-1",
    );
    assert.match(s, /Payment receipt/);
  });

  it("uses invoice wording when unpaid", () => {
    const s = buildInvoiceEmailSubject(
      {
        reference: "INV-1",
        status: "pending",
        amount: 100,
        amount_paid: 0,
        stripe_payment_status: undefined,
        stripe_paid_at: undefined,
      },
      "JOB-1",
    );
    assert.equal(s, "Invoice INV-1 — JOB-1");
  });
});

describe("resolveInvoiceCcEmail", () => {
  it("prefers INVOICE_CC_EMAIL env when set", () => {
    const prev = process.env.INVOICE_CC_EMAIL;
    process.env.INVOICE_CC_EMAIL = "ops@fixfy.com";
    try {
      assert.equal(resolveInvoiceCcEmail("other@x.com"), "ops@fixfy.com");
    } finally {
      if (prev === undefined) delete process.env.INVOICE_CC_EMAIL;
      else process.env.INVOICE_CC_EMAIL = prev;
    }
  });

  it("falls back to company email then support", () => {
    const prev = process.env.INVOICE_CC_EMAIL;
    delete process.env.INVOICE_CC_EMAIL;
    try {
      assert.equal(resolveInvoiceCcEmail("billing@company.com"), "billing@company.com");
      assert.equal(resolveInvoiceCcEmail(null), "support@getfixfy.com");
    } finally {
      if (prev !== undefined) process.env.INVOICE_CC_EMAIL = prev;
    }
  });
});
