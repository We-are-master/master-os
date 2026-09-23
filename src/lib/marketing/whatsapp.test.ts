import { strict as assert } from "node:assert";
import { test } from "node:test";
import { dentroDaJanela, ehPedidoDeSaida, primeiroNome } from "./whatsapp";

test("apresenta o primeiro nome", () => {
  assert.equal(primeiroNome("JOHN SMITH"), "John");
  assert.equal(primeiroNome("  maria  da silva"), "Maria");
});
test("cai em 'there' quando o nome não serve", () => {
  assert.equal(primeiroNome(null), "there");
  assert.equal(primeiroNome(""), "there");
  assert.equal(primeiroNome("J"), "there");
  assert.equal(primeiroNome("07700900123"), "there");
});

test("reconhece o botão e o STOP digitado", () => {
  assert.equal(ehPedidoDeSaida("Stop promotions"), true);
  assert.equal(ehPedidoDeSaida("STOP"), true);
  assert.equal(ehPedidoDeSaida(" unsubscribe. "), true);
});
test("não bloqueia quem só usou a palavra numa frase", () => {
  assert.equal(ehPedidoDeSaida("can you stop by at 3pm?"), false);
  assert.equal(ehPedidoDeSaida("how much for 2 bed?"), false);
  assert.equal(ehPedidoDeSaida(undefined), false);
});

test("segunda a sábado, 10h às 18h de Londres", () => {
  assert.equal(dentroDaJanela(new Date("2026-10-05T09:30:00Z")), true); // seg 10:30 BST
  assert.equal(dentroDaJanela(new Date("2026-10-05T08:30:00Z")), false); // seg 09:30 BST
  assert.equal(dentroDaJanela(new Date("2026-10-05T17:00:00Z")), false); // seg 18:00 BST
  assert.equal(dentroDaJanela(new Date("2026-10-04T12:00:00Z")), false); // domingo
  assert.equal(dentroDaJanela(new Date("2026-12-05T17:30:00Z")), true); // sáb 17:30 GMT
});
