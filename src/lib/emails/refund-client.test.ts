import assert from "node:assert/strict";
import { test } from "node:test";
import { montarEmailDeReembolso } from "./refund-client";

test("cartão: valor, final do cartão, job e prazo de 5 a 10 dias", () => {
  const m = montarEmailDeReembolso({ primeiroNome: "Jake Carr", referenciaDoJob: "JOB-9752", tituloDoJob: "Door repair", valor: 2, metodo: "stripe", finalDoCartao: "6987" });
  assert.equal(m.subject, "Your refund of £2.00 · JOB-9752");
  assert.match(m.text, /^Hi Jake,\n\nWe've refunded £2\.00 to your card ending 6987 for job JOB-9752 \(Door repair\)\. It usually shows on your statement within 5 to 10 working days/);
  assert.doesNotMatch(m.html + m.text, /—/);
});

test("transferência: 1 a 3 dias, sem cartão", () => {
  const m = montarEmailDeReembolso({ primeiroNome: null, referenciaDoJob: "JOB-1", tituloDoJob: null, valor: 50, metodo: "bank_transfer" });
  assert.match(m.text, /^Hi,\n\nWe're sending you a refund of £50\.00 by bank transfer for job JOB-1\. It should reach your account within 1 to 3 working days\./);
  assert.doesNotMatch(m.text, /card/);
});
