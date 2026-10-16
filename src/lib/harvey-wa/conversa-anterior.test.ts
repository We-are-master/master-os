import { test } from "node:test";
import assert from "node:assert/strict";
import { instrucaoDaConversaAnterior } from "./cerebro";

test("sem conversa anterior, nada muda no prompt", () => {
  assert.equal(instrucaoDaConversaAnterior([]), "");
});

test("com conversa anterior: diz que já se falaram e lista as falas (caso Justine, 16/10/2026)", () => {
  const t = instrucaoDaConversaAnterior([
    { papel: "harvey", texto: "It's £72 for 1 hour, fixed." },
    { papel: "cliente", texto: "No thanks, too much." },
  ]);
  assert.match(t, /do not introduce yourself/);
  assert.match(t, /You: It's £72/);
  assert.match(t, /Customer: No thanks/);
});
