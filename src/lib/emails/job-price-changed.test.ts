/**
 * Aviso de mudança de preço: valor novo em destaque, antigo riscado, e cada lado
 * só com o seu dinheiro (cliente nunca vê o repasse; parceiro nunca vê o preço do cliente).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClientJobPriceChangedEmail, buildPartnerJobPriceChangedEmail } from "./job-price-changed";

const base = {
  jobReference: "JOB-9800",
  jobTitle: "General Maintenance",
  propertyAddress: "12 Example Road, London E1 6AN",
};

const semTravessaoNemPlaceholder = (m: { subject: string; html: string; text: string }) => {
  for (const t of [m.subject, m.html, m.text]) {
    assert.doesNotMatch(t, /—/);
    assert.doesNotMatch(t, /\{\{/);
  }
};

test("cliente fixed: novo em destaque, antigo riscado, B2C", () => {
  const m = buildClientJobPriceChangedEmail({
    ...base,
    publico: { tipo: "b2c", primeiroNome: "Sarah" },
    oldAmount: 1234,
    newAmount: 1450.5,
    billing: "fixed",
  });
  assert.equal(m.subject, "Your booking price has been updated · JOB-9800");
  assert.match(m.text, /^Hi Sarah,$/m);
  assert.match(m.text, /£1,450\.50, Fixed price/);
  assert.match(m.text, /^Previously: £1,234\.00$/m);
  assert.match(m.html, /line-through[^"]*">£1,234\.00</);
  assert.match(m.html, /£1,450\.50/);
  assert.doesNotMatch(m.text, /time on site/);
  semTravessaoNemPlaceholder(m);
});

test("cliente B2B: Hi {empresa} team", () => {
  const m = buildClientJobPriceChangedEmail({
    ...base,
    publico: { tipo: "b2b", empresa: "Acme Lettings" },
    oldAmount: 100,
    newAmount: 120,
    billing: "fixed",
  });
  assert.match(m.text, /^Hi Acme Lettings team,$/m);
});

test("cliente hourly: taxa por hora e o valor final segue o tempo no local", () => {
  const m = buildClientJobPriceChangedEmail({
    ...base,
    publico: { tipo: "b2c", primeiroNome: "Sarah" },
    oldAmount: 216,
    newAmount: 240,
    billing: "hourly",
    hourly: { oldRate: 72, newRate: 80, hours: 3 },
  });
  assert.match(m.text, /£80\.00\/h/);
  assert.match(m.text, /final amount follows the time on site/);
  assert.match(m.text, /based on 3 hours/);
  assert.match(m.text, /New estimate: £240\.00/);
  assert.match(m.text, /Previously: £216\.00 · £72\.00\/h/);
  semTravessaoNemPlaceholder(m);
});

test("parceiro fixed: só o repasse, novo e antigo riscado", () => {
  const m = buildPartnerJobPriceChangedEmail({
    ...base,
    partnerFirstName: "Joe",
    oldPay: 90,
    newPay: 110,
    billing: "fixed",
    jobUrl: "https://trade.getfixfy.com",
  });
  assert.equal(m.subject, "Your pay has been updated · JOB-9800");
  assert.match(m.text, /Now: £110\.00/);
  assert.match(m.text, /Previously: £90\.00/);
  assert.match(m.html, /line-through[^"]*">£90\.00</);
  semTravessaoNemPlaceholder(m);
});

test("parceiro hourly: taxa dele por hora, total como sub", () => {
  const m = buildPartnerJobPriceChangedEmail({
    ...base,
    oldPay: 105,
    newPay: 120,
    billing: "hourly",
    hourly: { oldRate: 35, newRate: 40, hours: 3 },
  });
  assert.match(m.text, /New estimate: £120\.00, Based on 3 hours/);
  assert.match(m.text, /Hourly rate: £40\.00\/h/);
  assert.match(m.text, /Previously: £105\.00 · £35\.00\/h/);
  assert.match(m.text, /final amount follows the time on site/);
  semTravessaoNemPlaceholder(m);
});

test("nenhum lado vê o dinheiro do outro", () => {
  // Valores do cliente e do parceiro bem diferentes: um nunca aparece no e-mail do outro.
  const cliente = buildClientJobPriceChangedEmail({
    ...base,
    publico: { tipo: "b2c", primeiroNome: "Sarah" },
    oldAmount: 300,
    newAmount: 350,
    billing: "hourly",
    hourly: { oldRate: 72, newRate: 84, hours: 4 },
  });
  const parceiro = buildPartnerJobPriceChangedEmail({
    ...base,
    oldPay: 140,
    newPay: 160,
    billing: "hourly",
    hourly: { oldRate: 35, newRate: 40, hours: 4 },
  });
  for (const t of [cliente.subject, cliente.html, cliente.text]) assert.doesNotMatch(t, /£140|£160|£35\.00|£40\.00/);
  for (const t of [parceiro.subject, parceiro.html, parceiro.text]) assert.doesNotMatch(t, /£300|£350|£72\.00|£84\.00/);
  // Palavras só no texto visível (o HTML tem "margin" no CSS).
  for (const t of [cliente.subject, cliente.text]) assert.doesNotMatch(t, /\bmargin\b|partner/i);
  for (const t of [parceiro.subject, parceiro.text]) assert.doesNotMatch(t, /\bmargin\b|client|customer/i);
});
