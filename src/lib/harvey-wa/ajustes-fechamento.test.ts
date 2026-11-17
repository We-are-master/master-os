import { test } from "node:test";
import assert from "node:assert/strict";
import { instrucoesDosAjustes, PADRAO, validarAjustes } from "./ajustes";

test("fechamento: padrão é a equipe, valor estranho também", () => {
  assert.equal(validarAjustes({}).fechamento, "equipe");
  assert.equal(validarAjustes({ fechamento: "x" }).fechamento, "equipe");
  assert.equal(validarAjustes({ fechamento: "harvey" }).fechamento, "harvey");
  assert.doesNotMatch(instrucoesDosAjustes(PADRAO), /close the sale yourself/);
});

test("Harvey fecha: manda seguir até o link e só passar quando não consegue", () => {
  const t = instrucoesDosAjustes({ ...PADRAO, fechamento: "harvey" });
  assert.match(t, /you close the sale yourself/);
  assert.match(t, /create_payment_link/);
  assert.match(t, /only when you cannot close it yourself/);
});

test("sem link ou sem agenda, a instrução de fechar não entra", () => {
  assert.doesNotMatch(instrucoesDosAjustes({ ...PADRAO, fechamento: "harvey", pagamento: { ...PADRAO.pagamento, link: false } }), /close the sale yourself/);
  assert.doesNotMatch(instrucoesDosAjustes({ ...PADRAO, fechamento: "harvey", acessos: { ...PADRAO.acessos, agenda: false } }), /close the sale yourself/);
});
