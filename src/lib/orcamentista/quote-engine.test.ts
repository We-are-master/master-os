/**
 * O orçamentista só vale se a conta for a que o dono fixou. Cada caso aqui é
 * uma regra de negócio de 17/08/2026 que custaria dinheiro se regredisse:
 * override ganha da fórmula, job mínimo segura serviço por m², draft não
 * cota, material opcional não soma, pack físico arredonda pra cima, e a
 * venda de material é a média do mercado comprando do mais barato.
 *
 *   npx tsx --test src/lib/orcamentista/quote-engine.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { montarQuote, textoApresentavel, type ItemKit, type LinhaPricebook } from "./quote-engine";
import { quoteFromSuppliers, type SupplierPriceFact } from "./material-math";

const fornecedor = (
  family: string,
  variant: string,
  supplier: string,
  unit_cost: number,
): SupplierPriceFact => ({
  id: `${supplier}-${variant}`,
  family,
  variant,
  query: variant,
  supplier,
  unit_cost,
  list_price: 0,
  spec: {},
  sample_product: `${supplier} ${variant}`,
  source_url: `https://${supplier}.example/${encodeURIComponent(variant)}`,
});

const PRICEBOOK: LinhaPricebook[] = [
  { trade: "plumber", service: "Replace kitchen/basin tap (fit only)", unit: "per_item", price_gbp: 140, min_charge_gbp: null, status: "approved", override_gbp: null },
  { trade: "flooring", service: "Laminate fitting (labour)", unit: "per_m2", price_gbp: 15, min_charge_gbp: 180, status: "approved", override_gbp: null },
  { trade: "painter", service: "Paint medium bedroom/living (walls+ceiling)", unit: "per_room", price_gbp: 400, min_charge_gbp: null, status: "approved", override_gbp: 380 },
  { trade: "certificates", service: "Emergency Lighting Certificate", unit: "per_job", price_gbp: 150, min_charge_gbp: null, status: "draft", override_gbp: null },
  { trade: "carpenter", service: "Hang internal door (door excl.)", unit: "per_door", price_gbp: 140, min_charge_gbp: null, status: "approved", override_gbp: null },
];

const KITS: ItemKit[] = [
  { trade: "plumber", service: "Replace kitchen/basin tap (fit only)", family: "plumbing", variant: "Flexíveis (par)", qty: 1, optional: false, note: null },
  { trade: "plumber", service: "Replace kitchen/basin tap (fit only)", family: "plumbing", variant: "Torneira misturadora cozinha", qty: 1, optional: true, note: "cliente pode ja ter" },
  { trade: "carpenter", service: "Hang internal door (door excl.)", family: "door_hinge", variant: "Butt hinge 75mm satin (pair)", qty: 1.5, optional: false, note: "3 dobradiças" },
];

const FORNECEDORES: SupplierPriceFact[] = [
  fornecedor("plumbing", "Flexíveis (par)", "screwfix", 4.15),
  fornecedor("plumbing", "Flexíveis (par)", "toolstation", 8.3),
  fornecedor("plumbing", "Torneira misturadora cozinha", "screwfix", 32.99),
  fornecedor("plumbing", "Torneira misturadora cozinha", "bandq", 47.0),
  fornecedor("door_hinge", "Butt hinge 75mm satin (pair)", "screwfix", 4.49),
];

test("a venda de material é a média do mercado, comprando do mais barato", () => {
  const [flexi] = quoteFromSuppliers(FORNECEDORES.slice(0, 2));
  // custo £4.15 (screwfix), média £6.225 → max(média, 4.15×1.3=5.395) = 6.225 → £6.99
  assert.equal(flexi!.custo, 4.15);
  assert.equal(flexi!.melhor.supplier, "screwfix");
  assert.equal(flexi!.nossoPreco, 6.99);
});

test("o piso de 30% segura quando a média fica abaixo de custo × 1.30", () => {
  const rows = [fornecedor("f", "v", "a", 10), fornecedor("f", "v", "b", 10.5)];
  // média £10.25 < 10×1.3=13 → nosso preço £13.99
  assert.equal(quoteFromSuppliers(rows)[0]!.nossoPreco, 13.99);
});

test("torneira: labour + kit obrigatório somam; o opcional é oferecido, não somado", () => {
  const q = montarQuote(
    [{ trade: "plumber", service: "Replace kitchen/basin tap (fit only)", qty: 1 }],
    PRICEBOOK,
    KITS,
    FORNECEDORES,
  );
  assert.equal(q.labourTotal, 140);
  assert.equal(q.services[0]!.materials.length, 1); // só as flexis
  assert.equal(q.services[0]!.optionalMaterials.length, 1); // a torneira, oferecida
  assert.equal(q.materialsTotal, 6.99);
  assert.equal(q.total, 146.99);
  // margem dos materiais: venda 6.99 − custo 4.15
  assert.equal(q.materialsMarginGbp, 2.84);
});

test("serviço por m² respeita o job mínimo — 4 m² de laminado não paga a visita", () => {
  const pouco = montarQuote(
    [{ trade: "flooring", service: "Laminate fitting (labour)", qty: 4 }],
    PRICEBOOK, [], [],
  );
  assert.equal(pouco.services[0]!.lineTotal, 180); // 4×15=60 < 180 → mínimo
  assert.equal(pouco.services[0]!.minChargeApplied, true);

  const muito = montarQuote(
    [{ trade: "flooring", service: "Laminate fitting (labour)", qty: 20 }],
    PRICEBOOK, [], [],
  );
  assert.equal(muito.services[0]!.lineTotal, 300); // 20×15 > 180
  assert.equal(muito.services[0]!.minChargeApplied, false);
});

test("override do dono ganha da fórmula", () => {
  const q = montarQuote(
    [{ trade: "painter", service: "Paint medium bedroom/living (walls+ceiling)", qty: 2 }],
    PRICEBOOK, [], [],
  );
  assert.equal(q.services[0]!.unitPrice, 380);
  assert.equal(q.labourTotal, 760);
});

test("draft não cota: vira gap declarado, nunca preço", () => {
  const q = montarQuote(
    [{ trade: "certificates", service: "Emergency Lighting Certificate", qty: 1 }],
    PRICEBOOK, [], [],
  );
  assert.equal(q.services.length, 0);
  assert.equal(q.total, 0);
  assert.match(q.gaps[0]!, /still draft/);
});

test("serviço fora do pricebook vira gap com nome, não silêncio", () => {
  const q = montarQuote(
    [{ trade: "electrician", service: "Install new socket", qty: 1 }],
    PRICEBOOK, [], [],
  );
  assert.equal(q.services.length, 0);
  assert.match(q.gaps[0]!, /not in the pricebook/);
});

test("material físico arredonda pra cima: 3 dobradiças = 2 pares", () => {
  const q = montarQuote(
    [{ trade: "carpenter", service: "Hang internal door (door excl.)", qty: 1 }],
    PRICEBOOK, KITS, FORNECEDORES,
  );
  const dobradica = q.services[0]!.materials[0]!;
  assert.equal(dobradica.qty, 2); // ceil(1.5)
  assert.equal(dobradica.lineTotal, 2 * dobradica.unitPrice);
});

test("kit sem preço de fornecedor vira gap, e o resto da quote segue", () => {
  const q = montarQuote(
    [{ trade: "carpenter", service: "Hang internal door (door excl.)", qty: 1 }],
    PRICEBOOK, KITS, [], // sem fornecedores
  );
  assert.equal(q.services.length, 1);
  assert.equal(q.labourTotal, 140);
  assert.match(q.gaps[0]!, /no supplier price/);
});

test("o texto apresentável carrega serviço, material, opcional e gaps", () => {
  const q = montarQuote(
    [{ trade: "plumber", service: "Replace kitchen/basin tap (fit only)", qty: 1 }],
    PRICEBOOK, KITS, FORNECEDORES,
  );
  const t = textoApresentavel(q);
  assert.match(t, /Replace kitchen\/basin tap/);
  assert.match(t, /Flexíveis/);
  assert.match(t, /if needed: Torneira/);
  assert.match(t, /Total: £146\.99/);
});
