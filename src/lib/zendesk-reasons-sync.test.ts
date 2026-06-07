import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planCancellationPresetsBackfill } from "./zendesk-cancellation-reasons-sync";
import { planOnHoldPresetsBackfill } from "./zendesk-job-on-hold-reasons-sync";

describe("planOnHoldPresetsBackfill", () => {
  it("appends new hold presets with hold_ tag values", () => {
    const plan = planOnHoldPresetsBackfill([], [{ id: "test_reason", label: "Test Reason" }]);
    const testOpt = plan.options.find((o) => o.value === "hold_test_reason");
    assert.ok(testOpt);
    assert.equal(testOpt?.name, "Test Reason");
    assert.ok(plan.stats.append >= 1);
  });

  it("renames label when preset id matches", () => {
    const plan = planOnHoldPresetsBackfill(
      [{ name: "Old label", value: "hold_complaint" }],
      [{ id: "complaint", label: "Customer complaint" }],
    );
    const row = plan.options.find((o) => o.value === "hold_complaint");
    assert.equal(row?.name, "Customer complaint");
    assert.equal(plan.stats.rename, 1);
  });

  it("prunes removed OS hold tags", () => {
    const plan = planOnHoldPresetsBackfill(
      [
        { name: "Gone", value: "hold_removed_id" },
        { name: "Keep", value: "hold_other" },
      ],
      [{ id: "other", label: "Other" }],
    );
    assert.equal(plan.options.some((o) => o.value === "hold_removed_id"), false);
    assert.equal(plan.options.some((o) => o.value === "hold_other"), true);
    assert.equal(plan.stats.prune, 1);
  });
});

describe("planCancellationPresetsBackfill", () => {
  it("appends cancel presets with cancel_ tag values", () => {
    const plan = planCancellationPresetsBackfill([], [{ id: "client_requested", label: "Client requested" }]);
    const row = plan.options.find((o) => o.value === "cancel_client_requested");
    assert.ok(row);
    assert.equal(row?.name, "Client requested");
    assert.ok(plan.stats.append >= 1);
  });

  it("keeps non-OS zendesk options", () => {
    const plan = planCancellationPresetsBackfill(
      [{ name: "Legacy", value: "legacy_option" }],
      [{ id: "other", label: "Other" }],
    );
    assert.equal(plan.options.some((o) => o.value === "legacy_option"), true);
    assert.equal(plan.stats.keep, 1);
  });
});
