import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildClientJobDetailsChangedEmail,
  buildPartnerJobDetailsChangedEmail,
  mudancasReais,
} from "./job-details-changed";

const endereco = { campo: "address" as const, antes: "1 Old Road, W1 1AA", depois: "22 New Street, E2 2BB" };
const cliente = { campo: "client" as const, antes: "Jane Old", depois: "Mark New" };

test("ignora o que não mudou (caixa e espaços)", () => {
  assert.equal(mudancasReais([{ campo: "address", antes: "1  old road", depois: "1 Old Road" }]).length, 0);
  assert.equal(mudancasReais([endereco]).length, 1);
});

test("cliente: endereço novo e o antigo riscado, sem a troca de cliente", () => {
  const e = buildClientJobDetailsChangedEmail({
    publico: { tipo: "b2c", primeiroNome: "Jane" },
    jobReference: "JOB-1",
    jobTitle: "General Maintenance",
    mudancas: [endereco, cliente],
  });
  assert.match(e.subject, /Your booking has been updated · JOB-1/);
  assert.match(e.html, /22 New Street/);
  assert.match(e.html, /line-through[^>]*>1 Old Road/);
  assert.doesNotMatch(e.html, /Mark New/);
  assert.doesNotMatch(e.html + e.text + e.subject, /—/);
});

test("parceiro: endereço e cliente, com botão do app", () => {
  const e = buildPartnerJobDetailsChangedEmail({
    partnerFirstName: "Tom",
    jobReference: "JOB-1",
    jobTitle: "General Maintenance",
    mudancas: [cliente, endereco],
    jobUrl: "https://trade.example/jobs",
  });
  assert.match(e.subject, /Job details updated · JOB-1/);
  assert.match(e.html, /New address/);
  assert.match(e.html, /Mark New/);
  assert.match(e.html, /Open job in app/);
  assert.doesNotMatch(e.html + e.text + e.subject, /—/);
});
