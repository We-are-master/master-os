/**
 * Boas-vindas de conta: o preço combinado vira o destaque, sem travessão.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAccountWelcomeEmail, linhaDoPreco } from "./account-welcome";

test("por hora com mínimo: destaque e linha", () => {
  const e = buildAccountWelcomeEmail({ empresa: "Crestview Pinnacle", contato: "Mohsen Sayahi", prazo: "Net 7", precos: [
    { servico: "General Maintenance", modo: "hourly", valor: 45, horasMinimas: 2 },
    { servico: "Carpenter", modo: "hourly", valor: 45, horasMinimas: 2 },
  ] });
  assert.equal(e.subject, "Welcome to Fixfy, Crestview Pinnacle");
  assert.match(e.html, /Hi Mohsen,/);
  assert.match(e.html, />£90\.00</);
  assert.match(e.html, /covers up to 2 hours/);
  assert.match(e.html, /hello@getfixfy\.com/);
  assert.match(e.html, /General Maintenance, Carpenter/);
  assert.doesNotMatch(e.html + e.text, /[—–]/);
  assert.equal(linhaDoPreco({ servico: "x", modo: "hourly", valor: 45, horasMinimas: 2 }), "£45.00 per hour, minimum 2 hours (£90.00)");
});

test("sem preço combinado e sem contato: saudação à equipe, sem destaque", () => {
  const e = buildAccountWelcomeEmail({ empresa: "Acme Lettings", precos: [] });
  assert.match(e.html, /Hi Acme Lettings team,/);
  assert.doesNotMatch(e.html, /Per hour/);
});
