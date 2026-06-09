import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveInvoiceAccount,
  type InvoiceRepairContext,
  type RepairInvoiceRow,
} from "@/lib/billing-invoice-account-repair";

function emptyCtx(overrides: Partial<InvoiceRepairContext> = {}): InvoiceRepairContext {
  return {
    jobByRef: new Map(),
    jobIdToTicketAccount: new Map(),
    clientById: new Map(),
    quoteById: new Map(),
    quoteAccountByExternalRef: new Map(),
    requestById: new Map(),
    propertyIdToAccount: new Map(),
    jobRefToAccountFromSiblingInvoice: new Map(),
    accountIdsFromClientEmail: new Map(),
    allLinkedClients: [],
    accounts: [],
    ...overrides,
  };
}

function inv(id: string, opts: Partial<RepairInvoiceRow> = {}): RepairInvoiceRow {
  return {
    id,
    client_name: "Test Client",
    status: "pending",
    ...opts,
  };
}

describe("resolveInvoiceAccount", () => {
  it("uses persisted invoice.source_account_id first", () => {
    const result = resolveInvoiceAccount(
      inv("1", { source_account_id: "acc-hk", job_reference: "JOB-1" }),
      emptyCtx(),
    );
    assert.equal(result.accountId, "acc-hk");
    assert.equal(result.source, "invoice_source_account_id");
  });

  it("resolves via job client source_account_id", () => {
    const ctx = emptyCtx({
      jobByRef: new Map([
        [
          "JOB-1",
          { reference: "JOB-1", client_id: "client-1" },
        ],
      ]),
      clientById: new Map([
        ["client-1", { id: "client-1", source_account_id: "acc-ct" }],
      ]),
    });
    const result = resolveInvoiceAccount(inv("1", { job_reference: "JOB-1" }), ctx);
    assert.equal(result.accountId, "acc-ct");
    assert.equal(result.source, "job_client_source_account_id");
  });

  it("resolves via quote external_ref sibling (Zendesk ticket)", () => {
    const ctx = emptyCtx({
      jobByRef: new Map([
        [
          "JOB-99",
          { reference: "JOB-99", external_ref: "12345", external_source: "zendesk" },
        ],
      ]),
      quoteAccountByExternalRef: new Map([["12345", "acc-hk"]]),
    });
    const result = resolveInvoiceAccount(inv("1", { job_reference: "JOB-99" }), ctx);
    assert.equal(result.accountId, "acc-hk");
    assert.equal(result.source, "quote_external_ref_sibling");
  });

  it("resolves via ticket.job_id → account_id", () => {
    const ctx = emptyCtx({
      jobByRef: new Map([
        ["JOB-2", { id: "job-uuid-2", reference: "JOB-2" }],
      ]),
      jobIdToTicketAccount: new Map([["job-uuid-2", "acc-portal"]]),
    });
    const result = resolveInvoiceAccount(inv("1", { job_reference: "JOB-2" }), ctx);
    assert.equal(result.accountId, "acc-portal");
    assert.equal(result.source, "ticket_account_id");
  });

  it("resolves via sibling invoice on same job reference", () => {
    const ctx = emptyCtx({
      jobRefToAccountFromSiblingInvoice: new Map([["JOB-3", "acc-sibling"]]),
    });
    const result = resolveInvoiceAccount(inv("1", { job_reference: "JOB-3" }), ctx);
    assert.equal(result.accountId, "acc-sibling");
    assert.equal(result.source, "sibling_invoice");
  });

  it("resolves via client email → account", () => {
    const ctx = emptyCtx({
      jobByRef: new Map([
        ["JOB-4", { reference: "JOB-4", client_id: "client-4" }],
      ]),
      clientById: new Map([
        ["client-4", { id: "client-4", email: "billing@housekeep.com" }],
      ]),
      accountIdsFromClientEmail: new Map([["billing@housekeep.com", "acc-hk"]]),
    });
    const result = resolveInvoiceAccount(inv("1", { job_reference: "JOB-4" }), ctx);
    assert.equal(result.accountId, "acc-hk");
    assert.equal(result.source, "job_client_source_account_id");
  });

  it("returns unresolved when no account path matches", () => {
    const result = resolveInvoiceAccount(inv("1", { client_name: "Uly Lo" }), emptyCtx());
    assert.equal(result.accountId, null);
    assert.equal(result.source, "unresolved");
  });
});
