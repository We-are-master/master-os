import { test } from "node:test";
import assert from "node:assert/strict";
import { destinoDaResposta, prometeuAEquipe } from "./turno";
import { quoteParaCliente } from "./contas";

const base = { resposta: "That's £72 for the hour, tools included.", comEfeito: false, clienteEscreveuDeNovo: false, outroTurnoRespondeu: false, refeito: false, ultimaDoHarvey: null };

test("sozinho na conversa: envia", () => {
  assert.equal(destinoDaResposta(base), "enviar");
});

test("preço do catálogo não segura a resposta velha quando o cliente escreveu de novo", () => {
  assert.equal(destinoDaResposta({ ...base, clienteEscreveuDeNovo: true }), "descartar_cliente_escreveu");
});

test("outro turno respondeu enquanto este pensava: pensa de novo uma vez, depois descarta", () => {
  assert.equal(destinoDaResposta({ ...base, outroTurnoRespondeu: true }), "repensar");
  assert.equal(destinoDaResposta({ ...base, outroTurnoRespondeu: true, refeito: true }), "descartar_outro_turno");
});

test("link de pagamento, cotação pedida ou passagem sempre saem", () => {
  assert.equal(destinoDaResposta({ ...base, comEfeito: true, clienteEscreveuDeNovo: true, outroTurnoRespondeu: true }), "enviar");
});

test("a mesma frase duas vezes seguidas não sai", () => {
  assert.equal(destinoDaResposta({ ...base, ultimaDoHarvey: "That’s £72 for the hour, tools included!" }), "descartar_repetida");
  assert.equal(destinoDaResposta({ ...base, ultimaDoHarvey: "That's £144 for two hours." }), "enviar");
});

test("prometeu chamar alguém: conta", () => {
  for (const t of [
    "Let me grab someone from the team for this, give me a minute.",
    "Let me get Victor to pick this up and confirm the measuring visit side of it for you.",
    "I'll pass this to the team now.",
    "I'll loop in the office so they can sort the keys.",
    "Someone from the team will message you shortly.",
  ])
    assert.equal(prometeuAEquipe(t), true, t);
});

test("pergunta ou frase comum: não conta", () => {
  for (const t of ["Shall I get someone from the team to call you?", "I'll get that booked in for Thursday.", "Let me get the price for you: £180 for the half day.", "Our team arrives between 9 and 12."])
    assert.equal(prometeuAEquipe(t), false, t);
});

test("quote em palavras de cliente: valor só depois de enviada", () => {
  const q = { reference: "QT-0001", title: "Carpenter", property_address: "1 Test Road, SW1A 1AA", created_at: "2026-10-21T10:00:00Z", total_value: 250 };
  assert.deepEqual(quoteParaCliente({ ...q, status: "bidding" }).price, null);
  assert.equal(quoteParaCliente({ ...q, status: "bidding" }).status, "being priced by our professionals");
  assert.equal(quoteParaCliente({ ...q, status: "awaiting_customer" }).price, 250);
  assert.equal(quoteParaCliente({ ...q, status: "something_new" }).status, "something new");
});
