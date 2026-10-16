import assert from "node:assert/strict";
import { test } from "node:test";
import { textoDoCartaoSalvo } from "./texto-cartao-salvo";

test("entrada da cotação paga por inteiro, com saldo no job: diz o saldo e quando cobra", () => {
  const t = textoDoCartaoSalvo({ pct: 100, restante: 60 });
  assert.match(t, /^You pay the deposit now\./);
  assert.match(t, /remaining balance \(£60\.00\) is charged automatically when your job is completed and checked/);
});

test("link de 50% mantém o percentual", () => {
  assert.match(textoDoCartaoSalvo({ pct: 50, restante: 110 }), /^You pay the 50% deposit now\..*£110\.00/);
});

test("sem saldo: pagamento cheio, cartão só para extra ou cancelamento", () => {
  assert.match(textoDoCartaoSalvo({ pct: 100, restante: 0 }), /^You pay in full now\./);
});
