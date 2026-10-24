import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBookingPaymentEmail } from "./booking-payment-email";
import { FIXFY_CLIENT_BANK_DETAILS } from "./fixfy-client-bank-details";

const base = {
  clientName: "Sarah Jones",
  jobReference: "JOB-9800",
  invoiceReference: "INV-2026-999",
  serviceTitle: "Handyman",
  scope: "- Fix kitchen door\n- Replace hinge",
  dayLabel: "Wed 21 Oct 26",
  windowLabel: "between 9am and midday",
  address: "12 Example Road, London E1 6AN",
  total: 180,
  amountDueNow: 90,
  percent: 50,
  payLink: "https://os.getfixfy.com/pay/INV-2026-999?pct=50",
};

const SEM = (t: string) => {
  assert.doesNotMatch(t, /[–—]/);
  assert.doesNotMatch(t, /\{\{|undefined|null/);
};

test("#3 sinal: assunto, um botão com o valor, saldo calculado, transferência de booking", () => {
  const m = buildBookingPaymentEmail(base);
  assert.equal(m.subject, "Confirm your booking with a £90.00 deposit");
  assert.match(m.text, /^Hi Sarah,$/m);
  assert.match(m.text, /The remaining £90\.00 is due once the agreed work is complete\./);
  assert.match(m.text, /Pay £90\.00 deposit: https:\/\/os\.getfixfy\.com\/pay/);
  assert.match(m.text, /Proposed visit: Wed 21 Oct 26 · 09:00-12:00/);
  assert.match(m.text, /Work included: Fix kitchen door; Replace hinge/);
  assert.match(m.text, /We’ll confirm your booking once payment has been received and checked\./);
  assert.match(m.text, new RegExp(FIXFY_CLIENT_BANK_DETAILS.accountNumber));
  assert.equal((m.html.match(/display:block;background:#ED4B00/g) ?? []).length, 1, "um botão só");
  SEM(m.subject);
  SEM(m.text);
});

test("#4 total: assunto e botão", () => {
  const m = buildBookingPaymentEmail({ ...base, amountDueNow: 180, percent: 100, publico: { tipo: "b2b", empresa: "Acme Lettings" } });
  assert.equal(m.subject, "Confirm your Fixfy booking · £180.00");
  assert.match(m.text, /^Hi Acme Lettings team,$/m);
  assert.match(m.text, /Pay £180\.00 and confirm:/);
  assert.doesNotMatch(m.text, /Remaining balance|deposit/i);
  SEM(m.text);
});

test("sem dados bancários, sem bloco de transferência; sem data, sem linha de visita", () => {
  const m = buildBookingPaymentEmail({ ...base, bankDetails: [], dayLabel: null, windowLabel: null, clientName: "" });
  assert.doesNotMatch(m.text, /Prefer a bank transfer/);
  assert.doesNotMatch(m.text, /Proposed visit/);
  assert.match(m.text, /^Hi there,$/m);
});

test("job de cotação aceita: copy 'Quote accepted' e o assunto novo; booking direto fica como estava", () => {
  const base = { clientName: "Sarah Jones", jobReference: "JOB-9800", invoiceReference: "INV-2026-1188", serviceTitle: "General maintenance", scope: "Rehang bedroom door\nAdjust kitchen cabinet hinges\nReseal bath", dayLabel: "Wednesday 28 October 2026", windowLabel: "between 9am and midday", address: "12 Example Road, London E1 6AN", total: 180, amountDueNow: 90, percent: 50, payLink: "https://app.getfixfy.com/pay/INV-2026-1188" };
  const daCotacao = buildBookingPaymentEmail({ ...base, daCotacao: true });
  assert.equal(daCotacao.subject, "Your quote is accepted: confirm your booking");
  assert.match(daCotacao.html, /Deposit required/);
  assert.match(daCotacao.html, /Let’s get your booking confirmed/);
  assert.match(daCotacao.html, /Thanks for accepting your quote/);
  assert.match(daCotacao.html, /Your booking at a glance/);
  assert.match(daCotacao.html, /Pay £90\.00 deposit/);
  const direto = buildBookingPaymentEmail(base);
  assert.equal(direto.subject, "Confirm your booking with a £90.00 deposit");
  assert.doesNotMatch(direto.html, /Thanks for accepting your quote/);
});
