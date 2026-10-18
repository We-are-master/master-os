import { test } from "node:test";
import assert from "node:assert/strict";
import { tipoDoCatalogo } from "./tipo-de-trabalho";

const CAT = ["After Builders Clean", "Builder", "Carpenter", "Deep Clean", "Electrical Installation Condition Report", "End of Tenancy Clean", "Energy Performance Certificate", "Gas Safety Certificate", "General Maintenance", "Inventory Check", "Inventory Check-out", "Painter", "Plumber", "Regular Cleaning"];

test("nome do catálogo passa como está (sem diferença de maiúscula)", () => {
  assert.equal(tipoDoCatalogo("Carpenter", CAT), "Carpenter");
  assert.equal(tipoDoCatalogo("end of tenancy clean", CAT), "End of Tenancy Clean");
});

test("tipo inventado vira General Maintenance (caso Constantina, 16/10/2026)", () => {
  assert.equal(tipoDoCatalogo("Wardrobe disassembly and packing", CAT), "General Maintenance");
  assert.equal(tipoDoCatalogo("Electrician", CAT), "General Maintenance");
  assert.equal(tipoDoCatalogo("", CAT), "General Maintenance");
  assert.equal(tipoDoCatalogo(null, CAT), "General Maintenance");
});

test("pintura e limpeza vão para o tipo certo do catálogo", () => {
  assert.equal(tipoDoCatalogo("Painting and decorating", CAT), "Painter");
  assert.equal(tipoDoCatalogo("Cleaning", CAT), "Regular Cleaning");
  assert.equal(tipoDoCatalogo("Deep clean kitchen", CAT), "Deep Clean");
  assert.equal(tipoDoCatalogo("After-builders clean", CAT), "After Builders Clean");
  assert.equal(tipoDoCatalogo("Electrical Safety Report", CAT), "Electrical Installation Condition Report");
});

test("ofício com nome no catálogo (caso QT-2026-1248 'Plasterer', 18/10/2026)", () => {
  assert.equal(tipoDoCatalogo("Plasterer", CAT), "Builder");
  assert.equal(tipoDoCatalogo("Plasterboard and skim ceiling", CAT), "Builder");
  assert.equal(tipoDoCatalogo("Building work", CAT), "Builder");
  assert.equal(tipoDoCatalogo("Plumbing", CAT), "Plumber");
  assert.equal(tipoDoCatalogo("Carpentry", CAT), "Carpenter");
  assert.equal(tipoDoCatalogo("After builders clean", CAT), "After Builders Clean");
});
