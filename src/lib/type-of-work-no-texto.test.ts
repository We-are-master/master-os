import { test } from "node:test";
import assert from "node:assert/strict";
import { acharTypeOfWorkNoTexto } from "./type-of-work";

/** Os textos abaixo são os `scope` reais dos jobs que saíram classificados errado. */

test("JOB-9636: o certificado ganha do ofício escrito ao lado", () => {
  assert.equal(acharTypeOfWorkNoTexto("Electrician | EPC assessment"), "Energy Performance Certificate");
});

test("JOB-9635: deep clean não é 'Cleaning'", () => {
  assert.equal(acharTypeOfWorkNoTexto("Deep clean  Job details  Entrance: Easy access"), "Deep Clean");
});

test("JOB-9626: end of tenancy ganha de clean solto", () => {
  assert.equal(acharTypeOfWorkNoTexto("Job: End of Tenancy Cleaning.  Property layout: 1 bedroom"), "End of Tenancy Clean");
});

test("JOB-9501: after builders também tem nome próprio", () => {
  assert.equal(acharTypeOfWorkNoTexto("Job: After Builders Cleaning.  Arrival window 10:00 to 12:00"), "After Builders Clean");
});

test("JOB-9609: o EICR estava no texto o tempo todo", () => {
  assert.equal(
    acharTypeOfWorkNoTexto("Job: Freestanding Washer Install  Electrical Installation Condition Report - Safety Checks - EICR"),
    "Electrical Safety Report",
  );
});

test("o ofício vale quando nenhum serviço nomeado aparece", () => {
  assert.equal(acharTypeOfWorkNoTexto("Ceiling painting in the hallway"), "Painter");
  assert.equal(acharTypeOfWorkNoTexto("Leaking tap, need a plumber"), "Plumber");
  assert.equal(acharTypeOfWorkNoTexto("Handyman to fix two doors"), "General Maintenance");
});

test("sigla não casa dentro de outra palavra", () => {
  // "epc" solto vale; dentro de "epcot" não.
  assert.equal(acharTypeOfWorkNoTexto("EPC needed for the flat"), "Energy Performance Certificate");
  assert.equal(acharTypeOfWorkNoTexto("Trip to Epcot"), null);
});

test("limpeza sem qualificar não vira palpite", () => {
  // `Cleaning` está desativado no catálogo desde que o dono separou os tipos.
  // Sem dizer QUAL limpeza, cravar uma seria escolher faixa de preço no escuro.
  assert.equal(acharTypeOfWorkNoTexto("Cleaning required at the property"), null);
});

test("texto vazio não devolve nada", () => {
  assert.equal(acharTypeOfWorkNoTexto(""), null);
  assert.equal(acharTypeOfWorkNoTexto(null), null);
  assert.equal(acharTypeOfWorkNoTexto("   "), null);
});

test("gas safety e cp12 chegam no mesmo lugar", () => {
  assert.equal(acharTypeOfWorkNoTexto("CP12 due next week"), "Gas Safety Check");
  assert.equal(acharTypeOfWorkNoTexto("Gas safety check for the boiler"), "Gas Safety Check");
});

test("hífen não esconde o serviço (a Housekeep escreve assim)", () => {
  assert.equal(acharTypeOfWorkNoTexto("End-of-tenancy clean"), "End of Tenancy Clean");
  assert.equal(acharTypeOfWorkNoTexto("End-of-tenancy clean  Job details  Property type: Flat"), "End of Tenancy Clean");
});

test("o termo curto de mercado também casa", () => {
  assert.equal(acharTypeOfWorkNoTexto("Asbestos survey of plant room"), "Asbestos Management Survey");
});
