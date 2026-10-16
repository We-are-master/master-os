import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computePartnerChecklist } from "./partner-ready-check";
import type { PartnerDocLike } from "./partner-required-docs";

const doc = (doc_type: string, status: string, extra: Partial<PartnerDocLike> = {}): PartnerDocLike => ({
  id: `${doc_type}-${status}`,
  name: doc_type,
  doc_type,
  status,
  created_at: "2026-09-01T00:00:00Z",
  ...extra,
});

const ACTIVE = ["tou", "selfbill", "agreement"];

describe("computePartnerChecklist", () => {
  it("counts every mandatory document and every active agreement, never DBS", () => {
    const docs = [doc("id_proof", "pending"), doc("insurance", "approved"), doc("dbs", "approved")];
    const c = computePartnerChecklist(docs, new Set(["tou"]), ACTIVE);
    assert.equal(c.docsTotal, 4);
    assert.equal(c.contractsTotal, 3);
    assert.equal(c.docsUploaded, 2);
    assert.equal(c.docsValid, 1);
    assert.equal(c.contractsSigned, 1);
    assert.equal(c.uploadedPct, Math.round((3 / 7) * 100));
    assert.equal(c.validPct, Math.round((2 / 7) * 100));
  });

  it("is 100% uploaded when all four documents are sent and all agreements signed, even before approval", () => {
    const docs = ["id_proof", "proof_of_address", "right_to_work", "insurance"].map((t) => doc(t, "pending"));
    const c = computePartnerChecklist(docs, new Set(ACTIVE), ACTIVE);
    assert.equal(c.uploadedPct, 100);
    assert.equal(c.validPct, Math.round((3 / 7) * 100));
  });

  it("does not count a signature of an old agreement version", () => {
    const c = computePartnerChecklist([], new Set(["old-tou"]), ACTIVE);
    assert.equal(c.contractsSigned, 0);
  });

  it("expired approved documents are uploaded but not valid", () => {
    const c = computePartnerChecklist([doc("insurance", "approved", { expires_at: "2020-01-01" })], new Set(), ACTIVE);
    assert.equal(c.docsUploaded, 1);
    assert.equal(c.docsValid, 0);
  });
});
