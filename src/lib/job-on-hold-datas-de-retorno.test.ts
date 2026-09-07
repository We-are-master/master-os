import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarDatasDeRetorno,
  hojeEmLondres,
  MAX_DATAS_DE_RETORNO,
} from "./job-on-hold-datas-de-retorno";

const HOJE = "2026-09-08";

describe("normalizarDatasDeRetorno", () => {
  test("guarda o que serve, em ordem, sem repetir", () => {
    const r = normalizarDatasDeRetorno(["2026-09-12", "2026-09-10", "2026-09-12"], HOJE);
    assert.deepEqual(r.datas, ["2026-09-10", "2026-09-12"]);
    assert.deepEqual(r.recusadas, [{ valor: "2026-09-12", motivo: "repetida" }]);
  });

  test("hoje ainda vale — o parceiro pode dizer que consegue hoje", () => {
    assert.deepEqual(normalizarDatasDeRetorno([HOJE], HOJE).datas, [HOJE]);
  });

  test("data no passado não é disponibilidade", () => {
    const r = normalizarDatasDeRetorno(["2026-09-07"], HOJE);
    assert.deepEqual(r.datas, []);
    assert.deepEqual(r.recusadas, [{ valor: "2026-09-07", motivo: "passado" }]);
  });

  test("31 de fevereiro casa a regex e não existe", () => {
    const r = normalizarDatasDeRetorno(["2026-02-31", "2026-11-31"], HOJE);
    assert.deepEqual(r.datas, []);
    assert.deepEqual(r.recusadas.map((x) => x.motivo), ["inexistente", "inexistente"]);
  });

  test("formato solto é recusado, não adivinhado", () => {
    // Adivinhar "12/09/2026" seria escolher entre 12 de setembro e 9 de dezembro.
    for (const v of ["12/09/2026", "next tuesday", "2026-9-8", "20260912"]) {
      const r = normalizarDatasDeRetorno([v], HOJE);
      assert.deepEqual(r.datas, [], `não deveria aceitar ${v}`);
      assert.equal(r.recusadas[0]?.motivo, "formato");
    }
  });

  test("vazio, nulo e lixo não viram data", () => {
    assert.deepEqual(normalizarDatasDeRetorno(null, HOJE).datas, []);
    assert.deepEqual(normalizarDatasDeRetorno(undefined, HOJE).datas, []);
    assert.deepEqual(normalizarDatasDeRetorno("2026-09-10", HOJE).datas, []);
    assert.deepEqual(normalizarDatasDeRetorno(["", "   ", null], HOJE).datas, []);
  });

  test("tem teto, e o que passa dele é dito, não sumido", () => {
    const muitas = Array.from({ length: MAX_DATAS_DE_RETORNO + 2 }, (_, i) =>
      `2026-09-${String(10 + i).padStart(2, "0")}`,
    );
    const r = normalizarDatasDeRetorno(muitas, HOJE);
    assert.equal(r.datas.length, MAX_DATAS_DE_RETORNO);
    assert.equal(r.recusadas.length, 2);
    assert.ok(r.recusadas.every((x) => x.motivo === "excedeu"));
  });
});

describe("hojeEmLondres", () => {
  test("é o dia de Londres, não o do servidor", () => {
    assert.equal(hojeEmLondres(new Date("2026-09-08T22:30:00Z")), "2026-09-08");
    // 23:30 UTC já é dia 9 em Londres no horário de verão britânico.
    assert.equal(hojeEmLondres(new Date("2026-09-08T23:30:00Z")), "2026-09-09");
  });
});
