import { test } from "node:test";
import assert from "node:assert/strict";
import { classificarPedido, horasDoTexto, tipoDoPedido } from "./classificar-pedido";

const CAT = [
  { id: "gm", name: "General Maintenance", pricing_mode: "hourly", hourly_rate: 72, accepts_smart_price: true },
  { id: "car", name: "Carpenter", pricing_mode: "hourly", hourly_rate: 72, accepts_smart_price: true },
  { id: "plu", name: "Plumber", pricing_mode: "hourly", hourly_rate: 72, accepts_smart_price: true },
  { id: "pai", name: "Painter", pricing_mode: "hourly", hourly_rate: 72, accepts_smart_price: true },
  { id: "bui", name: "Builder", pricing_mode: "fixed", fixed_price: 0, hourly_rate: 0, accepts_smart_price: false },
  { id: "eot", name: "End of Tenancy Clean", pricing_mode: "fixed", fixed_price: 223 },
  { id: "dc", name: "Deep Clean", pricing_mode: "fixed", fixed_price: 194 },
  { id: "eicr", name: "Electrical Installation Condition Report", pricing_mode: "fixed", fixed_price: 120 },
];
const NOMES = CAT.map((c) => c.name);

test("nomes inventados nunca saem (casos 18-19/10/2026)", () => {
  assert.equal(tipoDoPedido("Plasterer", "plasterboard and plaster the ceiling, painting optional", NOMES), "Builder");
  assert.equal(tipoDoPedido("Handyman_time", "Lightly sand all blue painted areas to prepare for repainting", NOMES), "Painter");
  assert.equal(tipoDoPedido("Wardrobe disassembly and packing", "Disassemble a sliding wardrobe", NOMES), "General Maintenance");
});

test("pedido pequeno de handyman é por hora", () => {
  const c = classificarPedido({ servico: "Handyman work", descricao: "Adjust 2 toilet seats and hang 6-10 pictures" }, CAT);
  assert.equal(c.tipo, "General Maintenance");
  assert.equal(c.modo, "hora");
});

test("lixar cerca de 3h é pintura por hora", () => {
  const c = classificarPedido({ servico: "Handyman_time", descricao: "Lightly sand the painted walls and woodwork. The customer estimates around 3 hours." }, CAT);
  assert.equal(c.tipo, "Painter");
  assert.equal(c.modo, "hora");
  assert.equal(c.horasEstimadas, 3);
});

test("obra vai para os parceiros cotarem", () => {
  assert.equal(classificarPedido({ servico: "Plasterer", descricao: "Install new plasterboard and skim the ceiling" }, CAT).modo, "cotacao");
  assert.equal(classificarPedido({ servico: "Carpentry", descricao: "Insurance work following a flood in three or more rooms" }, CAT).modo, "cotacao");
  assert.equal(classificarPedido({ servico: "Building work", descricao: "Bathroom renovation" }, CAT).modo, "cotacao");
});

test("serviço só-cotação no catálogo é cotação", () => {
  const c = classificarPedido({ servico: "Builder", descricao: "Repair a garden wall" }, CAT);
  assert.equal(c.tipo, "Builder");
  assert.equal(c.modo, "cotacao");
});

test("limpeza e certificado são preço fixo", () => {
  assert.equal(classificarPedido({ servico: "End of tenancy", descricao: "2 bed flat" }, CAT).modo, "fixo");
  assert.equal(classificarPedido({ servico: "EICR", descricao: "1 bed flat" }, CAT).modo, "fixo");
});

test("mais de um dia de trabalho vira cotação", () => {
  const c = classificarPedido({ servico: "Painting", descricao: "Paint the hallway, about 14 hours of work" }, CAT);
  assert.equal(c.modo, "cotacao");
});

test("piso de madeira é carpinteiro e cotação (#51529)", () => {
  const c = classificarPedido({ servico: "Handyman", descricao: "Laying floorboards in the hallway, nails or glue to be confirmed" }, CAT);
  assert.equal(c.tipo, "Carpenter");
  assert.equal(c.modo, "cotacao");
  assert.equal(tipoDoPedido("Handyman", "Replace a broken skirting board in the lounge", NOMES), "Carpenter");
});

test("horas do texto", () => {
  assert.equal(horasDoTexto("a full day (up to 7 hours)"), 7);
  assert.equal(horasDoTexto("Up to half a day"), 3.5);
  assert.equal(horasDoTexto("around 3 hours"), 3);
  assert.equal(horasDoTexto("no idea"), null);
});
