import assert from "node:assert/strict";
import { test } from "node:test";
import { montarEmailDeReembolso } from "./refund-client";

const quando = "2026-10-21T10:00:00Z";

test("cartão: valor, final do cartão, job e prazo da Stripe", () => {
  const m = montarEmailDeReembolso({ primeiroNome: "Jake Carr", referenciaDoJob: "JOB-9752", tituloDoJob: "Door repair", valor: 2, metodo: "stripe", finalDoCartao: "6987", emitidoEm: quando });
  assert.equal(m.subject, "Your £2.00 refund has been issued · JOB-9752");
  assert.match(m.text, /Hi Jake,/);
  assert.match(m.text, /We’ve issued a refund of £2\.00 for Door repair to your card ending 6987\./);
  assert.match(m.text, /within 5 to 10 working days/);
  assert.match(m.text, /Issued: Wed 21 Oct 26/);
  assert.doesNotMatch(m.html + m.text + m.subject, /[–—]|\{\{/);
});

test("transferência: sem prazo inventado, sem cartão", () => {
  const m = montarEmailDeReembolso({ primeiroNome: null, referenciaDoJob: "JOB-1", tituloDoJob: null, valor: 50, metodo: "bank_transfer", emitidoEm: quando });
  assert.match(m.text, /Hi there,/);
  assert.match(m.text, /to your bank account\./);
  assert.doesNotMatch(m.text, /card|working days/);
});

test("B2B: saudação da empresa, nunca da pessoa", () => {
  const m = montarEmailDeReembolso({ primeiroNome: "Sarah Jones", empresa: "Acme Lettings", referenciaDoJob: "JOB-9800", tituloDoJob: "EICR", valor: 90, metodo: "stripe", emitidoEm: quando });
  assert.match(m.text, /Hi Acme Lettings team,/);
  assert.doesNotMatch(m.text, /Sarah/);
});
