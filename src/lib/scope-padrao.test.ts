/**
 * Scope no padrão Fixfy, com os textos reais de cada fonte (25/10/2026).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { jaNoPadrao, montarScope, scopeNoPadrao } from "./scope-padrao";

const semModelo = { usarModelo: false };

test("Housekeep: formulário vira blocos, o texto do cliente fica em NOTES", async () => {
  const s = await scopeNoPadrao(
    "End-of-tenancy clean\n\nJob details\n\nEntrance: Through picket fence gate, door on the left.\nProperty type: Flat\nBedrooms: 1\nBathrooms: 1\nAdditional rooms: 0\nAdditional notes: Flat is on first floor. No carpet cleaning needed as it is being removed. I will provide a visitor parking permit.",
    semModelo,
  );
  assert.equal(
    s,
    [
      "WORK\n- End-of-tenancy clean.",
      "PROPERTY\nFlat · 1 bed · 1 bath",
      "ACCESS\nEntrance: Through picket fence gate, door on the left.",
      `NOTES\nIn the customer's words: "Flat is on first floor. No carpet cleaning needed as it is being removed. I will provide a visitor parking permit."`,
    ].join("\n\n"),
  );
});

test("Housekeep com tarefa vaga, sem modelo: aponta para o texto do cliente", async () => {
  const s = (await scopeNoPadrao("Handyman\n\nJob details\n\nEntrance: Black door, buzzer for flat 2\nLength: 1\nTasks: Other odd jobs [other odd jobs x1]\nAdditional notes: Pivot a solid oak desk", semModelo))!;
  assert.match(s, /^WORK\n- See the customer's words in the notes below\./);
  assert.match(s, /ACCESS\nEntrance: Black door, buzzer for flat 2\./);
  assert.match(s, /NOTES\nBooked for 1 hour\.\nIn the customer's words: "Pivot a solid oak desk"/);
});

test("Fantastic: blocos em caixa alta", async () => {
  const s = (await scopeNoPadrao(
    "End of tenancy clean, move in.\n\nPROPERTY LAYOUT: 2 bedrooms, 2 bathrooms, 1 kitchen.\n\nCONDITIONS: property free of personal belongings.\n\nACCESS: call Paul on 07708526568 for access.\n\nPARKING: paid parking available.\n\n48hr guarantee only.",
    semModelo,
  ))!;
  assert.equal(
    s,
    [
      "WORK\n- End of tenancy clean, move in.",
      "PROPERTY\n2 bedrooms, 2 bathrooms, 1 kitchen.",
      "ACCESS\nCall Paul on 07708526568 for access.\nParking: paid parking available.",
      "NOTES\nConditions: property free of personal belongings.\n48hr guarantee only.",
    ].join("\n\n"),
  );
});

test("Site: Access, Parts e Customer notes", async () => {
  const s = (await scopeNoPadrao(
    "Carpenter, half day on site.\nParts: tell the customer what is needed before buying.\nAccess: Customer will be there. Parking: Free parking nearby.\nCustomer notes: Build 6 MDF shelves. Booked on WhatsApp with Harvey.",
    semModelo,
  ))!;
  assert.match(s, /^WORK\n- Carpenter, half day on site\./);
  assert.match(s, /MATERIALS\nTell the customer what is needed before buying\./);
  assert.match(s, /ACCESS\nCustomer will be there\.\nParking: Free parking nearby\./);
  assert.match(s, /In the customer's words: "Build 6 MDF shelves\."/);
  assert.doesNotMatch(s, /Harvey/);
});

test("texto solto sem modelo: cada linha vira tarefa, sem repetir em NOTES", async () => {
  const s = await scopeNoPadrao("Install 3 main curtain poles.\n\nInstall 1 small curtain pole in the kitchen.", semModelo);
  assert.equal(s, "WORK\n- Install 3 main curtain poles.\n- Install 1 small curtain pole in the kitchen.");
});

test("já no padrão volta igual; vazio é null", async () => {
  const pronto = montarScope({ trabalho: ["Fix a shelf"], imovel: [], acesso: [], materiais: [], notas: [], palavrasDoCliente: null });
  assert.ok(jaNoPadrao(pronto));
  assert.equal(await scopeNoPadrao(pronto, semModelo), pronto);
  assert.equal(await scopeNoPadrao("  ", semModelo), null);
});

test("resposta do modelo com dois objetos: vale o primeiro", async () => {
  const { primeiroObjetoParaTeste } = await import("./scope-padrao");
  assert.equal(primeiroObjetoParaTeste('{"work":["a {b}"]}\n{"work":[]}'), '{"work":["a {b}"]}');
});
