import { test } from "node:test";
import assert from "node:assert/strict";
import { conversaDoJobServe } from "./notify-partner-job-zendesk-server";

const wh = ["whistyle.uk@gmail.com", "hello@whistyle.co.uk"];

test("mesma conversa: mesmo assunto e só o parceiro (e a casa) nela", () => {
  const c = { subject: "Job Booked: Carpenter 21 Oct SW6 6JY", participants: [{ email: "whistyle.uk@gmail.com" }, { email: "leonardo@getfixfy.com" }] };
  assert.equal(conversaDoJobServe(c, "Job Booked: Carpenter 21 Oct SW6 6JY", wh), true);
});

test("job remarcado: assunto com a data velha abre e-mail novo (caso N1 9EN, 18/10/2026)", () => {
  const c = { subject: "Job Booked: General Maintenance 16 Oct N1 9EN", participants: [{ email: "whistyle.uk@gmail.com" }] };
  assert.equal(conversaDoJobServe(c, "Job Booked: General Maintenance 20 Oct N1 9EN", wh), false);
});

test("parceiro trocado: conversa com o parceiro anterior abre e-mail novo (caso Top Freeze → WHistyle)", () => {
  const c = { subject: "Job Booked: Plumber 19 Oct SW1V 3AX", participants: [{ email: "info@topfreeze.co.uk" }, { email: "whistyle.uk@gmail.com" }] };
  assert.equal(conversaDoJobServe(c, "Job Booked: Plumber 19 Oct SW1V 3AX", wh), false);
});

test("sem conversa lida: e-mail novo", () => {
  assert.equal(conversaDoJobServe(null, "x", wh), false);
});
