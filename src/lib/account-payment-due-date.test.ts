import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dueDateIsoFromAccountPaymentTerms,
  isAccountOrgBiweeklyGridTerms,
} from "./account-payment-due-date";
import { dueDateIsoFromPaymentTerms } from "./invoice-payment-terms";
import { workPeriodForJobStartYmd } from "./partner-payout-schedule";

const ORG_CTX = {
  orgStandardTerms: "Every 2 weeks on Friday",
  orgReferenceYmd: "2026-06-12",
};

describe("isAccountOrgBiweeklyGridTerms", () => {
  it("detects simple Every 2 weeks on Friday", () => {
    assert.equal(isAccountOrgBiweeklyGridTerms("Every 2 weeks on Friday", ORG_CTX.orgStandardTerms), true);
  });

  it("excludes cycle strings with embedded ref", () => {
    assert.equal(
      isAccountOrgBiweeklyGridTerms("Every 2 weeks cutoff Friday pay Friday ref 2026-06-12", ORG_CTX.orgStandardTerms),
      false,
    );
  });

  it("excludes Net 30", () => {
    assert.equal(isAccountOrgBiweeklyGridTerms("Net 30", ORG_CTX.orgStandardTerms), false);
  });

  it("excludes Due on Receipt (not biweekly grid)", () => {
    assert.equal(isAccountOrgBiweeklyGridTerms("Due on Receipt", ORG_CTX.orgStandardTerms), false);
  });
});

describe("dueDateIsoFromAccountPaymentTerms", () => {
  it("aligns simple biweekly with self-bill work period for job start 28 May 2026", () => {
    const anchor = new Date("2026-05-28T12:00:00");
    const invoiceDue = dueDateIsoFromAccountPaymentTerms(anchor, "Every 2 weeks on Friday", ORG_CTX);
    const sbPeriod = workPeriodForJobStartYmd("2026-05-28", ORG_CTX.orgStandardTerms, ORG_CTX.orgReferenceYmd);
    assert.ok(sbPeriod);
    assert.equal(invoiceDue, sbPeriod!.payoutDueYmd);
    assert.equal(invoiceDue, "2026-06-12");
  });

  it("differs from legacy +14 days Friday heuristic when anchors diverge", () => {
    const anchor = new Date("2026-05-30T12:00:00");
    const legacy = dueDateIsoFromPaymentTerms(anchor, "Every 2 weeks on Friday");
    const aligned = dueDateIsoFromAccountPaymentTerms(anchor, "Every 2 weeks on Friday", ORG_CTX);
    assert.notEqual(legacy, aligned);
    assert.equal(legacy, "2026-06-19");
    assert.equal(aligned, "2026-06-12");
  });

  it("leaves Net 30 unchanged", () => {
    const anchor = new Date("2026-05-28T12:00:00");
    const plain = dueDateIsoFromPaymentTerms(anchor, "Net 30");
    const wrapped = dueDateIsoFromAccountPaymentTerms(anchor, "Net 30", ORG_CTX);
    assert.equal(wrapped, plain);
  });

  it("respects account cycle ref when embedded in terms", () => {
    const anchor = new Date("2026-05-28T12:00:00");
    const terms = "Every 2 weeks cutoff Friday pay Friday ref 2026-05-30";
    const due = dueDateIsoFromAccountPaymentTerms(anchor, terms, ORG_CTX);
    const expected = dueDateIsoFromPaymentTerms(anchor, terms);
    assert.equal(due, expected);
  });

  it("Due on Receipt uses +72h not biweekly grid (JOB-9295 regression)", () => {
    const anchor = new Date("2026-06-15T12:00:00");
    const due = dueDateIsoFromAccountPaymentTerms(anchor, "Due on Receipt", ORG_CTX);
    assert.equal(due, "2026-06-18");
    assert.notEqual(due, "2026-06-26");
  });
});
