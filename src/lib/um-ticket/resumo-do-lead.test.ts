import { test } from "node:test";
import assert from "node:assert/strict";
import { lerFichaDoLead, notaDoMerge } from "./resumo-do-lead";

// Primeiro comentário do lead #51326 (14/10/2026), como o Zendesk devolve.
const FICHA = `NEW CHECKATRADE LEAD

Name: Hettie Jenvey
Phone: +447584077054
WhatsApp: https://wa.me/447584077054
Email: hettiejenvey@gmail.com
Postcode: SW11 1BG
Service: handyman work

What they asked for:
checkatrade-account:main

Enquiry · General Maintenance

Installing TV up on wall

The customer would ideally like the job to start as soon as possible (it's urgent).

OS contact: https://app.getfixfy.com/clients?clientId=576f3253-893d-4142-ad53-edd4d1d5cfc7
Checkatrade lead id: 01a136eb-09a2-79ce-8ca9-27ac0df03f00
Checkatrade account: main (Fixfy)

Hi Hettie, this is Fixfy. We've just received your Checkatrade request for handyman work.

Next action: awaiting reply on WhatsApp (Harvey answers and this ticket is merged into that conversation). No reply by 09:03: call the lead on +447584077054.`;

test("lê a ficha do lead do Checkatrade", () => {
  const r = lerFichaDoLead(FICHA)!;
  assert.equal(r.nome, "Hettie Jenvey");
  assert.equal(r.postcode, "SW11 1BG");
  assert.equal(r.servico, "handyman work");
  assert.equal(r.categoria, "General Maintenance");
  assert.equal(r.pedido, "Installing TV up on wall");
  assert.equal(r.urgencia, "as soon as possible (it's urgent)");
  assert.equal(r.linkOs, "https://app.getfixfy.com/clients?clientId=576f3253-893d-4142-ad53-edd4d1d5cfc7");
  assert.equal(r.leadId, "01a136eb-09a2-79ce-8ca9-27ac0df03f00");
  assert.equal(r.conta, "main (Fixfy)");
});

test("pedido com \\n literal e várias linhas vira um parágrafo; flexível na data", () => {
  const f = FICHA.replace("Installing TV up on wall", "Replace 25 downlights.\\nI can provide photos.").replace(
    "The customer would ideally like the job to start as soon as possible (it's urgent).",
    "The customer is flexible on the start date.",
  );
  const r = lerFichaDoLead(f)!;
  assert.equal(r.pedido, "Replace 25 downlights. I can provide photos.");
  assert.equal(r.urgencia, "flexible on the start date");
});

test("sem mensagem e campos com traço ficam nulos", () => {
  const f = FICHA.replace("Installing TV up on wall", "(no message)").replace("Email: hettiejenvey@gmail.com", "Email: -");
  const r = lerFichaDoLead(f)!;
  assert.equal(r.pedido, null);
  assert.equal(r.email, null);
});

test("texto que não é ficha devolve null", () => {
  assert.equal(lerFichaDoLead("Hi, I need a plumber"), null);
  assert.equal(lerFichaDoLead(null), null);
});

test("nota do merge: pedido em cima, sem travessão", () => {
  const n = notaDoMerge(51326, lerFichaDoLead(FICHA));
  assert.match(n, /^CHECKATRADE REQUEST/);
  assert.match(n, /Service: handyman work \(General Maintenance\)/);
  assert.match(n, /Postcode: SW11 1BG/);
  assert.match(n, /Urgency: as soon as possible/);
  assert.match(n, /Installing TV up on wall/);
  assert.match(n, /OS contact: https:\/\/app\.getfixfy\.com/);
  assert.match(n, /Checkatrade lead id: 01a136eb.*\(account: main \(Fixfy\)\)/);
  assert.match(n, /Lead ticket #51326 .*merged here\.$/);
  assert.ok(!n.includes("—"));
});

test("nota do merge sem ficha: leva o começo do primeiro comentário", () => {
  assert.equal(notaDoMerge(1, null), "Lead ticket #1 (first contact, template sent) merged here.");
  const n = notaDoMerge(2, null, "x".repeat(2000));
  assert.match(n, /Original request \(first comment of #2\):/);
  assert.ok(n.length < 1100);
});
