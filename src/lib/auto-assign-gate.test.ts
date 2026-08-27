import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autoAssignGate,
  isCleaningTypeOfWork,
  suggestedPartnerMarginPctFor,
  autoAssignMarginFloorPctFor,
  type AutoAssignGateJob,
} from "./auto-assign-gate";

const completo: AutoAssignGateJob = {
  serviceType: "Painter",
  propertyAddress: "12 Test Road, London E14 9GE",
  scope: "Paint two bedroom walls, make good.",
  scheduledStartAt: "2026-09-01T08:00:00Z",
  scheduledEndAt: "2026-09-01T11:00:00Z",
  jobType: "fixed",
  clientPrice: 100,
  partnerCost: 60,
  hourlyClientRate: null,
  hourlyPartnerRate: null,
};

test("job completo com margem 40% passa", () => {
  const r = autoAssignGate(completo);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.marginPct, 40);
});

test("cada campo faltando aparece pelo nome", () => {
  const r = autoAssignGate({
    ...completo,
    serviceType: null,
    propertyAddress: "12 Test Road, London", // sem postcode
    scope: "  ",
    scheduledEndAt: null,
    clientPrice: 0,
    partnerCost: null,
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    for (const campo of [
      "Trade",
      "Postcode",
      "Customer price",
      "Partner suggested pay",
      "Arrival window",
      "Scope",
    ]) {
      assert.ok(r.missing.includes(campo), `faltou listar: ${campo}`);
    }
  }
});

test("piso de trades: 29% de margem trava, 30% passa", () => {
  const trava = autoAssignGate({ ...completo, partnerCost: 71 }); // 29%
  assert.equal(trava.ok, false);
  if (!trava.ok) assert.equal(trava.floorPct, 30);
  const passa = autoAssignGate({ ...completo, partnerCost: 70 }); // 30%
  assert.equal(passa.ok, true);
});

test("piso de cleaning: 19% trava, 20% passa", () => {
  const cleaning = { ...completo, serviceType: "Deep Clean" };
  const trava = autoAssignGate({ ...cleaning, partnerCost: 81 }); // 19%
  assert.equal(trava.ok, false);
  if (!trava.ok) assert.equal(trava.floorPct, 20);
  const passa = autoAssignGate({ ...cleaning, partnerCost: 80 }); // 20%
  assert.equal(passa.ok, true);
});

test("job hourly usa as taxas por hora", () => {
  const r = autoAssignGate({
    ...completo,
    jobType: "hourly",
    clientPrice: 0,
    partnerCost: 0,
    hourlyClientRate: 45,
    hourlyPartnerRate: 27, // 40%
  });
  assert.equal(r.ok, true);
});

test("cleaning é detectado pelas variantes canônicas", () => {
  for (const label of ["Cleaning", "Deep Clean", "End of Tenancy Clean", "after builders cleaning"]) {
    assert.equal(isCleaningTypeOfWork(label), true, label);
  }
  assert.equal(isCleaningTypeOfWork("Painter"), false);
  assert.equal(isCleaningTypeOfWork(null), false);
});

test("sugestão 40/30 e pisos 30/20 por categoria", () => {
  assert.equal(suggestedPartnerMarginPctFor("Painter"), 40);
  assert.equal(suggestedPartnerMarginPctFor("Painter", 45), 45);
  assert.equal(suggestedPartnerMarginPctFor("Deep Clean", 45), 30);
  assert.equal(autoAssignMarginFloorPctFor("Painter"), 30);
  assert.equal(autoAssignMarginFloorPctFor("Cleaning"), 20);
});
