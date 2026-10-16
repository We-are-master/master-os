import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { linhaDoRetrabalho, PRAZO_DO_RETRABALHO_H } from "./retrabalho";

const ORIGINAL = {
  id: "j1", reference: "JOB-9600", title: "End of tenancy clean", client_id: "c1", client_name: "Jane Doe",
  property_address: "10 High St, SE24 9NE", partner_id: "p1", partner_name: "F&V Cleaning", catalog_service_id: "s1",
  scope: "3 bed EoT", external_ref: "50000",
};

describe("linhaDoRetrabalho", () => {
  it("is £0 on both sides, offered only to the original partner for 24h", () => {
    const agora = new Date("2026-10-09T10:00:00Z");
    const l = linhaDoRetrabalho(ORIGINAL, "Oven not cleaned", 50111, agora);
    assert.equal(l.client_price, 0);
    assert.equal(l.partner_cost, 0);
    assert.equal(l.partner_id, null);
    assert.equal(l.status, "auto_assigning");
    assert.deepEqual(l.auto_assign_invited_partner_ids, ["p1"]);
    assert.equal(new Date(l.auto_assign_expires_at!).getTime() - agora.getTime(), PRAZO_DO_RETRABALHO_H * 3_600_000);
    assert.match(l.internal_notes, /remedial-of:JOB-9600 · complaint ticket #50111/);
    assert.match(l.scope, /Oven not cleaned/);
    assert.equal(l.title, "Remedial: End of tenancy clean");
  });

  it("without a partner it goes straight to the team", () => {
    const l = linhaDoRetrabalho({ ...ORIGINAL, partner_id: null }, "x", null);
    assert.equal(l.status, "unassigned");
    assert.equal(l.auto_assign_expires_at, null);
  });
});
