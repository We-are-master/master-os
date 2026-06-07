import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeBreakevenMonthly,
  computeHealthyMonthly,
  computePulseRevenueGoalSuggestions,
  pulseRevenueGoalStatus,
  resolvePulseMonthlyRevenueGoal,
  resolvePulsePeriodRevenueGoal,
} from "./pulse-revenue-goal";
import { parseFrontendSetup } from "./frontend-setup";

describe("computeBreakevenMonthly", () => {
  it("computes breakeven with fixed=10k, gm=40%", () => {
    assert.equal(computeBreakevenMonthly(10_000, 40), 25_000);
  });
});

describe("computeHealthyMonthly", () => {
  it("computes healthy with fixed=10k, gm=40%, net=30%", () => {
    assert.ok(Math.abs(computeHealthyMonthly(10_000, 40, 30)! - 100_000) < 0.01);
  });

  it("returns null when gm <= healthy net", () => {
    assert.equal(computeHealthyMonthly(10_000, 30, 30), null);
  });
});

describe("resolvePulsePeriodRevenueGoal", () => {
  it("prorates 5 working days of 22 monthly working days", () => {
    const setup = parseFrontendSetup({
      working_days: [1, 2, 3, 4, 5],
    });
    const monthlyGoal = 100_000;
    const from = new Date(2026, 4, 4);
    const to = new Date(2026, 4, 8);
    const result = resolvePulsePeriodRevenueGoal({ from, to }, setup, monthlyGoal);
    assert.equal(result.workingDaysInPeriod, 5);
    const monthlyWd = 5 * 4.345;
    const expected = (monthlyGoal / monthlyWd) * 5;
    assert.ok(Math.abs(result.periodGoal - expected) < 0.01);
    const pct = (result.periodGoal / monthlyGoal) * 100;
    assert.ok(Math.abs(pct - (5 / monthlyWd) * 100) < 0.1);
    assert.ok(Math.abs(pct - 22.7) < 1);
  });
});

describe("pulseRevenueGoalStatus", () => {
  it("marks above when revenue meets goal", () => {
    assert.equal(pulseRevenueGoalStatus(50_000, 50_000).status, "above");
  });

  it("marks on_track at 95%", () => {
    assert.equal(pulseRevenueGoalStatus(9_500, 10_000).status, "on_track");
  });

  it("marks below under 95%", () => {
    assert.equal(pulseRevenueGoalStatus(9_400, 10_000).status, "below");
  });
});

describe("resolvePulseMonthlyRevenueGoal", () => {
  it("uses healthy mode by default", () => {
    const setup = parseFrontendSetup({ target_margin_pct: 40, pulse_healthy_net_margin_pct: 30 });
    const { monthlyGoal } = resolvePulseMonthlyRevenueGoal(setup, 10_000);
    assert.ok(monthlyGoal != null && Math.abs(monthlyGoal - 100_000) < 0.01);
  });

  it("returns error when gm <= healthy net", () => {
    const setup = parseFrontendSetup({ target_margin_pct: 30, pulse_healthy_net_margin_pct: 30 });
    const suggestions = computePulseRevenueGoalSuggestions(10_000, setup);
    assert.ok(suggestions.error);
    const { monthlyGoal, error } = resolvePulseMonthlyRevenueGoal(setup, 10_000);
    assert.equal(monthlyGoal, null);
    assert.ok(error);
  });
});
