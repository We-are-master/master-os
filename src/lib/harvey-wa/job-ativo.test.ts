import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { escolherJobAtivo, type JobDoCliente } from "./job-ativo";

const job = (p: Partial<JobDoCliente>): JobDoCliente => ({ id: "j", status: "scheduled", scheduled_date: "2026-10-20", updated_at: "2026-10-16T10:00:00Z", external_source: "zendesk", external_ref: "51255", ...p });

describe("WhatsApp conversation: the client's active job ticket", () => {
  it("picks the scheduled job with a Zendesk ticket (Jessica Rooney, JOB-9725)", () => {
    assert.deepEqual(escolherJobAtivo([job({ id: "9725" })], "2026-10-16"), { ticketId: 51255, jobId: "9725" });
  });
  it("ignores completed, cancelled and deleted jobs", () => {
    const jobs = ["completed", "cancelled", "deleted"].map((status) => job({ status }));
    assert.equal(escolherJobAtivo(jobs, "2026-10-16"), null);
  });
  it("ignores jobs without a numeric Zendesk ticket", () => {
    assert.equal(escolherJobAtivo([job({ external_source: "housekeep", external_ref: "HK-1" }), job({ external_ref: null })], "2026-10-16"), null);
  });
  it("prefers the next upcoming visit over a past one", () => {
    const r = escolherJobAtivo(
      [job({ id: "past", scheduled_date: "2026-10-10", updated_at: "2026-10-16T12:00:00Z", external_ref: "1" }), job({ id: "next", scheduled_date: "2026-10-21", external_ref: "2" }), job({ id: "later", scheduled_date: "2026-10-30", external_ref: "3" })],
      "2026-10-16",
    );
    assert.equal(r?.jobId, "next");
  });
  it("without an upcoming date, takes the most recently updated", () => {
    const r = escolherJobAtivo([job({ id: "a", status: "final_check", scheduled_date: "2026-10-01", updated_at: "2026-10-02T00:00:00Z", external_ref: "1" }), job({ id: "b", status: "awaiting_payment", scheduled_date: "2026-10-05", updated_at: "2026-10-15T00:00:00Z", external_ref: "2" })], "2026-10-16");
    assert.equal(r?.jobId, "b");
  });
});
