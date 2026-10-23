import { test } from "node:test";
import assert from "node:assert/strict";
import { cobrancaDoBookingHousekeep, horasDoBooking } from "./booking-por-hora";

const emailLocksmith =
  "Job type Postcode Arrival Frequency Hours Total Job report Locksmith KT3 3HL 12:00-15:00 One-off 1.0 hrs £60.00 Link";

test("lê as horas da linha do e-mail", () => {
  assert.equal(horasDoBooking(emailLocksmith), 1);
  assert.equal(horasDoBooking("Handyman NW9 4DX 15:00-18:00 One-off 2.0 hrs £135.00"), 2);
  assert.equal(horasDoBooking("sem horas aqui"), null);
});

test("booking da Housekeep sem quote nasce por hora: taxa = total ÷ horas", () => {
  const c = cobrancaDoBookingHousekeep({ ehHousekeep: true, temQuote: false, totalGbp: 135, texto: "2.0 hrs £135.00", servico: "Handyman" });
  assert.deepEqual(c, { rate_type: "hourly", hourly_client_rate: 67.5, billed_hours: 2 });
});

test("booking que veio de quote nossa continua fixo", () => {
  assert.equal(cobrancaDoBookingHousekeep({ ehHousekeep: true, temQuote: true, totalGbp: 60, texto: emailLocksmith, servico: "Locksmith" }), null);
});

test("limpeza continua fixa", () => {
  assert.equal(cobrancaDoBookingHousekeep({ ehHousekeep: true, temQuote: false, totalGbp: 153.6, texto: "4.0 hrs £153.60", servico: "End of Tenancy Clean" }), null);
});

test("outra conta, ou sem horas/valor: não mexe", () => {
  assert.equal(cobrancaDoBookingHousekeep({ ehHousekeep: false, temQuote: false, totalGbp: 60, texto: emailLocksmith, servico: "Locksmith" }), null);
  assert.equal(cobrancaDoBookingHousekeep({ ehHousekeep: true, temQuote: false, totalGbp: 60, texto: "Locksmith £60", servico: "Locksmith" }), null);
  assert.equal(cobrancaDoBookingHousekeep({ ehHousekeep: true, temQuote: false, totalGbp: null, texto: emailLocksmith, servico: "Locksmith" }), null);
});
