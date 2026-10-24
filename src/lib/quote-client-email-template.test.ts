import assert from "node:assert/strict";
import { test } from "node:test";
import { buildQuoteClientEmail } from "./quote-client-email-template";
import { assuntoDaCotacao, fraseDePagamentoDaCotacao, montarQuoteSent } from "./zendesk-quote-sent";
import type { QuotePDFData } from "@/lib/pdf/quote-template";

const DASHES = /[—–]/;

const dados: QuotePDFData = {
  reference: "Q-2026-120",
  title: "Handyman work",
  clientName: "Sarah Jones",
  clientEmail: "sarah@example.com",
  totalValue: 180,
  createdAt: "2026-10-14T10:00:00Z",
  expiresAt: "2026-10-21",
  items: [
    { description: "Labour", quantity: 1, unitPrice: 150, total: 150 },
    { description: "Materials", quantity: 1, unitPrice: 30, total: 30 },
  ],
  depositRequired: 90,
  scope: "Fix the kitchen cupboard door and reseal the bath.",
  serviceType: "Handyman work",
  propertyAddress: "12 Albert Road, London NW5 1AB",
};

const opcoes = { acceptUrl: "https://app.getfixfy.com/quote/respond?token=t&action=accept", rejectUrl: "https://app.getfixfy.com/quote/respond?token=t&action=reject" };

test("frase de pagamento: entrada e saldo calculados da cotação", () => {
  assert.equal(
    fraseDePagamentoDaCotacao({ total: 180, entrada: 90 }),
    "A deposit of £90.00 is required to confirm your booking. The remaining £90.00 is due when the job is done.",
  );
  assert.equal(fraseDePagamentoDaCotacao({ total: 180, entrada: 180 }), "Payment of £180.00 is required to confirm your booking.");
});

test("sem entrada não inventa entrada: só os termos acordados, ou nada", () => {
  assert.equal(fraseDePagamentoDaCotacao({ total: 180 }), null);
  assert.equal(fraseDePagamentoDaCotacao({ total: 180, entrada: 0, termosAcordados: "Payment is due within 30 days of the invoice." }), "Payment is due within 30 days of the invoice.");
});

test("assunto da copy, sem Lead e sem travessão", () => {
  assert.equal(assuntoDaCotacao("Handyman work", "Q-2026-120"), "Your handyman work quote is ready · Q-2026-120");
  assert.equal(assuntoDaCotacao("EICR", "Q-1"), "Your EICR quote is ready · Q-1");
  assert.equal(assuntoDaCotacao(null, "Q-1"), "Your quote is ready · Q-1");
});

test("Resend (21): B2C cumprimenta pelo primeiro nome, um botão, recusar como link", () => {
  const e = buildQuoteClientEmail(dados, opcoes);
  assert.equal(e.assunto, "Your handyman work quote is ready · Q-2026-120");
  assert.match(e.text, /^QUOTE READY\nYour quote is ready/);
  assert.match(e.text, /Hi Sarah,/);
  assert.match(e.text, /Review and accept quote: https:\/\/app\.getfixfy\.com/);
  assert.match(e.text, /Decline quote: https:\/\/app\.getfixfy\.com/);
  assert.match(e.text, /Deposit required: £90\.00 to confirm your booking\nRemaining balance: £90\.00 when the job is done/);
  assert.match(e.text, /Valid until: Wed 21 Oct 26/);
  assert.match(e.text, /Itemised pricing: Labour £150\.00 · Materials £30\.00/);
  assert.doesNotMatch(e.text, /The Fixfy team/);
  assert.match(e.text, /A PDF copy of this quote is attached/);
  assert.equal((e.html.match(/display:block;background:#ED4B00/g) ?? []).length, 1, "um botão só");
  for (const s of [e.assunto, e.html, e.text]) {
    assert.doesNotMatch(s, DASHES);
    assert.doesNotMatch(s, /\{\{/);
    assert.doesNotMatch(s, /[✓⏱]/);
  }
});

test("B2B: o nome da empresa, nunca o da pessoa de contato", () => {
  const e = buildQuoteClientEmail({ ...dados, clientName: "John Smith" }, { ...opcoes, publico: { tipo: "b2b", empresa: "Acme Lettings" } });
  assert.match(e.text, /Hi Acme Lettings team,/);
  assert.doesNotMatch(e.text, /John/);
  const semEmpresa = buildQuoteClientEmail(dados, { ...opcoes, publico: { tipo: "b2b", empresa: "" } });
  assert.match(semEmpresa.text, /Hi team,/);
  const jaTeam = buildQuoteClientEmail(dados, { ...opcoes, publico: { tipo: "b2b", empresa: "Acme Ops Team" } });
  assert.match(jaTeam.text, /Hi Acme Ops Team,/);
});

test("sem nome: Hi there; linhas vazias somem; texto do cliente é escapado", () => {
  const e = buildQuoteClientEmail({ ...dados, clientName: "", scope: "<b>door</b>", propertyAddress: undefined, items: [] }, opcoes);
  assert.match(e.text, /Hi there,/);
  assert.doesNotMatch(e.text, /Property:/);
  assert.match(e.html, /&lt;b&gt;door&lt;\/b&gt;/);
});

test("modelo de agente: sem inc VAT e com a linha de agente", () => {
  const e = buildQuoteClientEmail(dados, { ...opcoes, agentModel: true });
  assert.doesNotMatch(e.text, /inc VAT/);
  assert.match(e.text, /as their agent/);
  assert.match(buildQuoteClientEmail(dados, opcoes).text, /£180\.00 inc VAT/);
});

test("Zendesk (20): mesmo miolo, sem tabela de linhas, assunto da copy", () => {
  const z = montarQuoteSent({
    customerName: "Sarah Jones", reference: "Q-2026-120", title: "Handyman work", propertyAddress: "12 Albert Road", scope: "Fix door",
    totalGbp: 180, expiresAt: "2026-10-21", acceptUrl: opcoes.acceptUrl, rejectUrl: opcoes.rejectUrl, depositRequired: 90,
  });
  assert.equal(z.assunto, "Your handyman work quote is ready · Q-2026-120");
  assert.match(z.html, /Hi Sarah,/);
  assert.doesNotMatch(z.html, /<!DOCTYPE/);
  assert.doesNotMatch(z.html, DASHES);
  assert.doesNotMatch(z.assunto, /^Lead/);
});
