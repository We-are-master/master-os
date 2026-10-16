import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveJobCompletionInstant, resolveJobCompletionYmd } from "./job-completion-anchor";
import { dueDateIsoFromAccountPaymentTerms, isAccountOrgBiweeklyGridTerms } from "./account-payment-due-date";

const ORG = { orgStandardTerms: "Every 2 weeks on Friday", orgReferenceYmd: "2026-06-12" };

describe("resolveJobCompletionInstant", () => {
  it("prefers the partner's final report over everything else", () => {
    const d = resolveJobCompletionInstant({
      final_report: { submitted_at: "2026-10-08T16:45:46.687Z" },
      partner_timer_ended_at: "2026-10-07T10:00:00Z",
      completed_date: "2026-10-10",
      scheduled_date: "2026-10-06",
    });
    assert.equal(d?.toISOString().slice(0, 10), "2026-10-08");
  });

  it("falls back to the timer, then completed_date, then the schedule", () => {
    assert.equal(resolveJobCompletionYmd({ partner_timer_ended_at: "2026-10-07T10:00:00Z", completed_date: "2026-10-10" }), "2026-10-07");
    assert.equal(resolveJobCompletionYmd({ completed_date: "2026-10-10", scheduled_date: "2026-10-06" }), "2026-10-10");
    assert.equal(resolveJobCompletionYmd({ scheduled_date: "2026-10-06" }), "2026-10-06");
    assert.equal(resolveJobCompletionYmd({}), null);
  });

  it("job finished on the 9th but approved on the 12th still counts from the 9th", () => {
    const done = resolveJobCompletionInstant({ final_report: { submitted_at: "2026-10-09T15:00:00Z" }, completed_date: "2026-10-12" })!;
    assert.equal(dueDateIsoFromAccountPaymentTerms(done, "Net 7", ORG), "2026-10-16");
  });
});

describe("account terms no longer fall onto the org fortnight by mistake", () => {
  it("45 days and Every 7 days are not the org grid", () => {
    assert.equal(isAccountOrgBiweeklyGridTerms("45 days", ORG.orgStandardTerms), false);
    assert.equal(isAccountOrgBiweeklyGridTerms("Every 7 days", ORG.orgStandardTerms), false);
    assert.equal(isAccountOrgBiweeklyGridTerms("Every 2 weeks on Friday", ORG.orgStandardTerms), true);
  });

  it("Homyze 45 days from 9 Oct is 23 Nov", () => {
    assert.equal(dueDateIsoFromAccountPaymentTerms(new Date("2026-10-09T12:00:00"), "45 days", ORG), "2026-11-23");
  });

  it("Net 7 from 9 Oct is 16 Oct", () => {
    assert.equal(dueDateIsoFromAccountPaymentTerms(new Date("2026-10-09T12:00:00"), "Net 7", ORG), "2026-10-16");
  });
});
