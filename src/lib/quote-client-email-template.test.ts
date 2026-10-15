import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHowToAcceptText } from "./quote-client-email-template";

test("com botão e entrada: manda tocar no Accept e diz entrada e saldo", () => {
  const t = buildHowToAcceptText({ hasAcceptButton: true, total: 300, depositRequired: 150 });
  assert.equal(
    t,
    "Tap Accept quote above. A deposit of £150.00 secures the booking, and the balance of £150.00 is due when the job is done. We'll then confirm the date and arrival window by email.",
  );
});

test("sem entrada não fala de pagamento", () => {
  const t = buildHowToAcceptText({ hasAcceptButton: true, total: 300 });
  assert.equal(t, "Tap Accept quote above. We'll then confirm the date and arrival window by email.");
});

test("sem botão pede para responder o e-mail", () => {
  assert.match(buildHowToAcceptText({ hasAcceptButton: false, total: 90 }), /^Reply to this email to go ahead\./);
});

test("entrada igual ao total vira pagamento cheio, sem saldo", () => {
  const t = buildHowToAcceptText({ hasAcceptButton: true, total: 90, depositRequired: 90 });
  assert.match(t, /Payment of £90\.00 secures the booking\./);
  assert.doesNotMatch(t, /balance/);
});

test("nenhum travessão no texto", () => {
  assert.doesNotMatch(buildHowToAcceptText({ hasAcceptButton: true, total: 300, depositRequired: 100 }), /—/);
});
