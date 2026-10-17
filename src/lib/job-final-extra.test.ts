import assert from "node:assert/strict";
import { test } from "node:test";
import { extraFromHours, motivoDoExtra, partnerAmountFromShare, partnerShareOfJob } from "./job-final-extra";

test("horas extras: cada lado pela sua taxa, em centavos", () => {
  assert.deepEqual(extraFromHours({ hours: 1.5, clientRate: 72, partnerRate: 45 }), { clientAmount: 108, partnerAmount: 67.5 });
  assert.deepEqual(extraFromHours({ hours: -2, clientRate: 72, partnerRate: 45 }), { clientAmount: 0, partnerAmount: 0 });
});

test("parte do parceiro pela margem do job", () => {
  const share = partnerShareOfJob({ clientTotal: 120, partnerTotal: 70 });
  assert.equal(partnerAmountFromShare(30, share), 17.5);
  assert.equal(partnerShareOfJob({ clientTotal: 0, partnerTotal: 70 }), 0);
  assert.equal(partnerShareOfJob({ clientTotal: 100, partnerTotal: 150 }), 1);
});

test("motivo: o da equipe, senão as horas", () => {
  assert.equal(motivoDoExtra({ kind: "hours", hours: 2, clientRate: 72, clientAmount: 144, partnerAmount: 90, reason: "" }), "Extra at final review: 2 extra hours at £72.00/h");
  assert.equal(motivoDoExtra({ kind: "amount", clientAmount: 30, partnerAmount: 18, reason: "Extra shelf" }), "Extra at final review: Extra shelf");
});
