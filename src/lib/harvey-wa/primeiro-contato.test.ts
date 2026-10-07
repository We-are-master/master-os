import { test } from "node:test";
import assert from "node:assert/strict";
import { telefoneE164 } from "./primeiro-contato";

test("telefone vira +44 do jeito que o Sunshine quer", () => {
  assert.equal(telefoneE164("07700 900123"), "+447700900123");
  assert.equal(telefoneE164("+44 7700 900123"), "+447700900123");
  assert.equal(telefoneE164("447700900123"), "+447700900123");
  assert.equal(telefoneE164("7700900123"), "+447700900123");
  assert.equal(telefoneE164("12345"), null);
  assert.equal(telefoneE164(null), null);
});
