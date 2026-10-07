import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hojeLondres, inicioDaSemana, inicioDoDiaLondres, somarDias } from "./jarvis-resumo";

describe("dia de Londres", () => {
  it("23h30 UTC no verão já é o dia seguinte em Londres", () => {
    assert.equal(hojeLondres(new Date("2026-07-14T23:30:00Z")), "2026-07-15");
  });
  it("23h30 UTC no inverno ainda é o mesmo dia", () => {
    assert.equal(hojeLondres(new Date("2026-01-14T23:30:00Z")), "2026-01-14");
  });
  it("meia-noite de Londres no verão é 23h UTC da véspera", () => {
    assert.equal(inicioDoDiaLondres("2026-07-15"), "2026-07-14T23:00:00.000Z");
  });
  it("meia-noite de Londres no inverno é meia-noite UTC", () => {
    assert.equal(inicioDoDiaLondres("2026-01-15"), "2026-01-15T00:00:00.000Z");
  });
  it("dia da troca de horário (29/03/2026) ainda começa em UTC+0", () => {
    assert.equal(inicioDoDiaLondres("2026-03-29"), "2026-03-29T00:00:00.000Z");
  });
});

describe("semana", () => {
  it("quarta 07/10/2026 → segunda 05/10", () => {
    assert.equal(inicioDaSemana("2026-10-07"), "2026-10-05");
  });
  it("domingo pertence à semana que começou na segunda anterior", () => {
    assert.equal(inicioDaSemana("2026-10-11"), "2026-10-05");
  });
  it("segunda é o próprio dia", () => {
    assert.equal(inicioDaSemana("2026-10-05"), "2026-10-05");
  });
  it("somarDias atravessa mês", () => {
    assert.equal(somarDias("2026-10-31", 1), "2026-11-01");
  });
});
