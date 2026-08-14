import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPartnerJobConfirmationEmail,
  buildPartnerJobConfirmationRequestEmail,
  formatPartnerJobEmailScheduleLine,
} from "./partner-job-confirmation";

test("formatPartnerJobEmailScheduleLine returns TBC when no schedule fields", () => {
  assert.equal(formatPartnerJobEmailScheduleLine({}), "TBC");
});

test("formatPartnerJobEmailScheduleLine includes arrival window when start/end set", () => {
  const line = formatPartnerJobEmailScheduleLine({
    scheduledDate: "2026-06-18",
    scheduledStartAt: "2026-06-18T10:00:00.000Z",
    scheduledEndAt: "2026-06-18T13:00:00.000Z",
  });
  assert.match(line, /Jun 2026/);
  assert.match(line, /Arrival time/i);
});

test("job offer HTML includes Date row with schedule line", () => {
  const { html, text } = buildPartnerJobConfirmationRequestEmail({
    partnerFirstName: "Acme Plumbing",
    jobReference: "JOB-9270",
    jobTitle: "Carpenter",
    clientName: "Client",
    propertyAddress: "SE8 3AJ",
    scheduledDate: "2026-06-18",
    scheduledStartAt: "2026-06-18T10:00:00.000Z",
    scheduledEndAt: "2026-06-18T13:00:00.000Z",
    scope: "Hang doors",
    priceDisplay: "£249.00 inc VAT",
    acceptUrl: "https://example.com/accept",
  });

  assert.match(html, />Date<\/p>/);
  assert.match(html, /Arrival time/i);
  assert.match(text, /^Date:\s+/m);
  assert.match(text, /Arrival time/i);
});

test("job offer HTML shows TBC when no schedule", () => {
  const { html, text } = buildPartnerJobConfirmationRequestEmail({
    partnerFirstName: "Acme Plumbing",
    jobReference: "JOB-9270",
    jobTitle: "Carpenter",
    clientName: "Client",
    propertyAddress: "SE8 3AJ",
    scope: "Hang doors",
    priceDisplay: "£249.00",
    acceptUrl: "https://example.com/accept",
  });

  assert.match(html, />TBC<\/p>/);
  assert.match(text, /Date:\s+TBC/);
});

test("job confirmado mostra o telefone do cliente, com link de ligar", () => {
  // O parceiro já foi alocado: ele precisa avisar que está a caminho, ou que o
  // portão está trancado.
  const { html, text } = buildPartnerJobConfirmationEmail({
    partnerFirstName: "Tony",
    jobReference: "JOB-9427",
    jobTitle: "General Maintenance",
    clientName: "Nehal Patel",
    clientPhone: "+44 7727 580572",
    propertyAddress: "171 Blackfriars Rd, London, SE1 8ER",
    scope: "Assemble one wardrobe.",
    jobType: "fixed",
    priceDisplay: "£90.00",
    reportUrl: "https://example.com/report",
  });

  assert.match(html, />Phone<\/td>/);
  assert.match(html, /\+44 7727 580572/);
  assert.match(html, /href="tel:\+447727580572"/);
  assert.match(text, /^Phone: \+44 7727 580572$/m);
});

test("sem telefone, a linha some em vez de sair vazia", () => {
  const { html, text } = buildPartnerJobConfirmationEmail({
    partnerFirstName: "Tony",
    jobReference: "JOB-9427",
    jobTitle: "General Maintenance",
    clientName: "Nehal Patel",
    clientPhone: null,
    propertyAddress: "SE1 8ER",
    scope: "Assemble one wardrobe.",
    jobType: "fixed",
    priceDisplay: "£90.00",
    reportUrl: "https://example.com/report",
  });

  assert.doesNotMatch(html, />Phone<\/td>/);
  assert.doesNotMatch(text, /^Phone:/m);
});

test("o convite de auto-assign NUNCA leva telefone", () => {
  // Este email sai para todos os parceiros que casam com o trade, e a maioria
  // nunca vai pisar naquele endereço. O builder não tem o campo, e este teste
  // existe para que adicioná-lo quebre aqui primeiro.
  const { html, text } = buildPartnerJobConfirmationRequestEmail({
    partnerFirstName: "Acme Plumbing",
    jobReference: "JOB-9270",
    jobTitle: "Carpenter",
    clientName: "Nehal Patel",
    propertyAddress: "SE8 3AJ",
    scope: "Hang doors",
    priceDisplay: "£249.00",
    acceptUrl: "https://example.com/accept",
  });

  assert.doesNotMatch(html, />Phone<\/td>/);
  assert.doesNotMatch(text, /^Phone:/m);
  // O único `tel:` permitido é o do nosso suporte, no rodapé.
  for (const m of html.matchAll(/href="tel:([^"]*)"/g)) {
    assert.match(m[1], /^\+?4420/, `tel: inesperado no convite: ${m[1]}`);
  }
});
