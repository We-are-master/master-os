import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ehDaReguaAntiga, emailDoPasso, passosFeitos, proximoPasso } from "./followup-leads";

// Horários em BST (UTC+1): "2026-10-14T09:00:00Z" é 10h em Londres.
const d = (iso: string) => new Date(iso);

describe("régua do follow-up de lead", () => {
  it("conta os passos pelas tags", () => {
    assert.equal(passosFeitos([], false), 0);
    assert.equal(passosFeitos([], true), 1);
    assert.equal(passosFeitos(["lead_checkin_sent"], false), 2);
    assert.equal(passosFeitos(["lead_fu_1", "lead_fu_3"], false), 3);
  });

  it("e-mail 1 sai na hora", () => {
    assert.equal(proximoPasso(0, d("2026-10-14T08:00:00Z"), d("2026-10-14T08:00:00Z"), d("2026-10-14T08:10:00Z")), 1);
  });

  it("check-in às 18h, com 4h de folga", () => {
    const primeiro = d("2026-10-14T08:00:00Z");
    assert.equal(proximoPasso(1, primeiro, d("2026-10-14T08:10:00Z"), d("2026-10-14T15:59:00Z")), null);
    assert.equal(proximoPasso(1, primeiro, d("2026-10-14T08:10:00Z"), d("2026-10-14T17:00:00Z")), 2);
  });

  it("lead que chega às 19h leva o check-in no dia seguinte às 18h", () => {
    const primeiro = d("2026-10-14T18:00:00Z");
    assert.equal(proximoPasso(1, primeiro, d("2026-10-14T18:10:00Z"), d("2026-10-14T19:00:00Z")), null);
    assert.equal(proximoPasso(1, primeiro, d("2026-10-14T18:10:00Z"), d("2026-10-15T16:00:00Z")), null);
    assert.equal(proximoPasso(1, primeiro, d("2026-10-14T18:10:00Z"), d("2026-10-15T17:00:00Z")), 2);
  });

  it("e-mail 3 no dia seguinte às 10h, e-mail 4 às 16h", () => {
    const primeiro = d("2026-10-14T08:00:00Z");
    assert.equal(proximoPasso(2, primeiro, d("2026-10-14T17:00:00Z"), d("2026-10-14T19:30:00Z")), null);
    assert.equal(proximoPasso(2, primeiro, d("2026-10-14T17:00:00Z"), d("2026-10-15T09:00:00Z")), 3);
    assert.equal(proximoPasso(3, primeiro, d("2026-10-15T09:00:00Z"), d("2026-10-15T14:00:00Z")), null);
    assert.equal(proximoPasso(3, primeiro, d("2026-10-15T09:00:00Z"), d("2026-10-15T15:00:00Z")), 4);
  });

  it("último e-mail e fecha no dia 3 às 10h", () => {
    const primeiro = d("2026-10-14T08:00:00Z");
    assert.equal(proximoPasso(4, primeiro, d("2026-10-15T15:00:00Z"), d("2026-10-15T19:30:00Z")), null);
    assert.equal(proximoPasso(4, primeiro, d("2026-10-15T15:00:00Z"), d("2026-10-16T08:30:00Z")), null);
    assert.equal(proximoPasso(4, primeiro, d("2026-10-15T15:00:00Z"), d("2026-10-16T09:00:00Z")), 5);
    assert.equal(proximoPasso(5, primeiro, d("2026-10-17T09:00:00Z"), d("2026-10-18T09:00:00Z")), null);
  });

  it("lead de antes da régua entra como dia 2", () => {
    assert.equal(ehDaReguaAntiga(d("2026-10-12T08:00:00Z"), ["lead_checkin_sent", "lead_call"]), true);
    assert.equal(ehDaReguaAntiga(d("2026-10-12T08:00:00Z"), ["lead_fu_3"]), false);
    assert.equal(ehDaReguaAntiga(d("2026-10-14T08:00:00Z"), []), false);
    const vespera = d("2026-10-13T12:00:00Z");
    assert.equal(proximoPasso(2, vespera, vespera, d("2026-10-14T09:00:00Z")), 3);
  });

  it("os e-mails não têm travessão e assinam como Fixfy Team", () => {
    for (let p = 1; p <= 5; p++) {
      const t = emailDoPasso(p, "Ann", "handyman work");
      assert.ok(!t.includes("—"), `passo ${p}`);
      assert.ok(t.startsWith("Hi Ann,") && t.endsWith("Fixfy Team"), `passo ${p}`);
    }
  });
});
