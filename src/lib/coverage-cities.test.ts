import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOutwardCode } from "./coverage-cities";
import { outwardMatchesIncluded } from "./partner-coverage";

describe("normalizeOutwardCode", () => {
  test("postcode completo perde só o inward", () => {
    assert.equal(normalizeOutwardCode("EC1V 2NX"), "EC1V");
    assert.equal(normalizeOutwardCode("E17 5BU"), "E17");
    assert.equal(normalizeOutwardCode("SW19 5QG"), "SW19");
    assert.equal(normalizeOutwardCode("W1G 6PR"), "W1G");
    assert.equal(normalizeOutwardCode("E1 3AQ"), "E1");
  });

  test("sem espaço dá o mesmo", () => {
    assert.equal(normalizeOutwardCode("EC1V2NX"), "EC1V");
    assert.equal(normalizeOutwardCode("e17 5bu"), "E17");
  });

  test("outward de QUATRO caracteres fica inteiro — era aqui que quebrava", () => {
    // Antes: EC1V → "E", DA10 → "D". A cobertura do parceiro virava uma letra
    // e casava com meia Inglaterra.
    assert.equal(normalizeOutwardCode("EC1V"), "EC1V");
    assert.equal(normalizeOutwardCode("DA10"), "DA10");
    assert.equal(normalizeOutwardCode("SW1A"), "SW1A");
    assert.equal(normalizeOutwardCode("EC2M"), "EC2M");
  });

  test("outward de dois e três caracteres continua igual", () => {
    assert.equal(normalizeOutwardCode("E1"), "E1");
    assert.equal(normalizeOutwardCode("N19"), "N19");
    assert.equal(normalizeOutwardCode("SW9"), "SW9");
  });

  test("lixo não vira cobertura", () => {
    for (const v of ["", "  ", "LONDON", "n/a", "12345", null, undefined]) {
      assert.equal(normalizeOutwardCode(v), "", `deveria recusar ${JSON.stringify(v)}`);
    }
  });
});

describe("outwardMatchesIncluded, depois do conserto", () => {
  test("quem cobre EC1V NÃO cobre E17 nem E1", () => {
    assert.equal(outwardMatchesIncluded("E17", ["EC1V"]), false);
    assert.equal(outwardMatchesIncluded("E1", ["EC1V"]), false);
    assert.equal(outwardMatchesIncluded("EC1V", ["EC1V"]), true);
  });

  test("quem cobre DA10 não cobre Derby nem Durham", () => {
    assert.equal(outwardMatchesIncluded("DE1", ["DA10"]), false);
    assert.equal(outwardMatchesIncluded("DH1", ["DA10"]), false);
    assert.equal(outwardMatchesIncluded("DA10", ["DA10"]), true);
  });

  test("a área ainda cobre os seus distritos: E1 cobre E17", () => {
    // Prefixo continua valendo, e é o que deixa o parceiro dizer "toda a E".
    assert.equal(outwardMatchesIncluded("E17", ["E1"]), true);
    assert.equal(outwardMatchesIncluded("SW19", ["SW1"]), true);
  });
});
