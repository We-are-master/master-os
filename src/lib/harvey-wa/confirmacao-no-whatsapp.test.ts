import assert from "node:assert/strict";
import { test } from "node:test";
import { textoDaConfirmacao } from "./confirmacao-no-whatsapp";

test("com janela: dia, janela e referência, primeiro nome", () => {
  assert.equal(
    textoDaConfirmacao({ nome: "Jake Carr", dia: "Tuesday 21 October", janela: "9:00 AM – 12:00 PM", referencia: "JOB-9750" }),
    "Hi Jake, you're booked in for Tuesday 21 October, between 9:00 AM and 12:00 PM (JOB-9750). Your professional is confirmed. Any questions, just reply here.",
  );
});

test("sem janela não diz 'between To be confirmed'", () => {
  const t = textoDaConfirmacao({ nome: null, dia: "Tuesday 21 October", janela: "To be confirmed", referencia: "JOB-9750" });
  assert.doesNotMatch(t, /between/);
  assert.match(t, /We'll confirm the arrival time/);
  assert.doesNotMatch(t, /—/);
});
