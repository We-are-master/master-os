import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTypeOfWork } from "./type-of-work";

describe("normalizeTypeOfWork: nome de trade nunca sai em minúscula", () => {
  test("a lista canônica manda na grafia", () => {
    // Era isto na página de bid da QT-2026-1139: "painter", em caixa baixa.
    assert.equal(normalizeTypeOfWork("painter"), "Painter");
    assert.equal(normalizeTypeOfWork("PAINTER"), "Painter");
    assert.equal(normalizeTypeOfWork("  plumber "), "Plumber");
    assert.equal(normalizeTypeOfWork("gas safety certificate"), "Gas Safety Certificate");
  });

  test("texto livre ganha maiúscula só na PRIMEIRA letra", () => {
    // Não é title case: o resto do título é como o escritório escreveu.
    assert.equal(normalizeTypeOfWork("ceiling painting"), "Ceiling painting");
    assert.equal(normalizeTypeOfWork("bathroom refit"), "Bathroom refit");
  });

  test("sigla não é rebaixada", () => {
    assert.equal(normalizeTypeOfWork("EICR inspection"), "EICR inspection");
    assert.equal(normalizeTypeOfWork("PAT testing and EICR"), "PAT testing and EICR");
  });

  test("o apelido continua ganhando de tudo, inclusive na grafia", () => {
    assert.equal(normalizeTypeOfWork("deep cleaning"), "Deep Clean");
    assert.equal(normalizeTypeOfWork("handyman"), "General Maintenance");
    // O apelido escreve "of" minúsculo de propósito, e é ele quem manda:
    // capitalizar palavra a palavra estragaria a grafia inglesa correta.
    assert.equal(normalizeTypeOfWork("end of tenancy clean"), "End of Tenancy Clean");
  });

  test("vazio continua vazio, e não vira espaço", () => {
    assert.equal(normalizeTypeOfWork(""), "");
    assert.equal(normalizeTypeOfWork("   "), "");
    assert.equal(normalizeTypeOfWork(null), "");
    assert.equal(normalizeTypeOfWork(undefined), "");
  });

  test("o que já estava certo não muda", () => {
    for (const n of ["Painter", "General Maintenance", "Fire Risk Assessment", "Boiler Service"]) {
      assert.equal(normalizeTypeOfWork(n), n);
    }
  });
});
