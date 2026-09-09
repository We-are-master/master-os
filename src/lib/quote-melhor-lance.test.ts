import { test } from "node:test";
import assert from "node:assert/strict";
import { sellFromMargin, marginPercent } from "./catalog-pricing-floor-ceiling";

test("40% e margem sobre a venda, como o banco ja grava", () => {
  assert.equal(sellFromMargin(380, 40), 633.33);
  assert.equal(sellFromMargin(420, 40), 700);
  assert.equal(sellFromMargin(100, 40), 166.67);
});

test("a ida e a volta se fecham", () => {
  const venda = sellFromMargin(380, 40)!;
  assert.equal(Math.round(marginPercent(venda, 380)!), 40);
});

test("nao confunde com markup", () => {
  assert.notEqual(sellFromMargin(380, 40), 532);
});

test("custo invalido ou margem impossivel devolve null, nunca um numero errado", () => {
  assert.equal(sellFromMargin(0, 40), null);
  assert.equal(sellFromMargin(-5, 40), null);
  assert.equal(sellFromMargin(100, 100), null);
  assert.equal(sellFromMargin(100, -1), null);
  assert.equal(sellFromMargin(Number.NaN, 40), null);
});

test("margem zero devolve o proprio custo", () => {
  assert.equal(sellFromMargin(250, 0), 250);
});

import { escolherMelhorLance, MARGEM_PADRAO } from "./quote-melhor-lance";

const lance = (o: Partial<Parameters<typeof escolherMelhorLance>[0][number]> & { id: string }) => ({
  partner_id: "p", partner_name: "Alguém", bid_amount: 100, status: "submitted",
  created_at: "2026-09-08T10:00:00Z", ...o,
});

test("o menor lance ganha e vira preco com 40%", () => {
  const r = escolherMelhorLance([lance({ id: "a", bid_amount: 500 }), lance({ id: "b", bid_amount: 380 })]);
  assert.equal(r!.melhor.id, "b");
  assert.equal(r!.precoAoCliente, 633.33);
  assert.equal(r!.margem, MARGEM_PADRAO);
});

test("o lance absurdo nao envenena a escolha (QT-2026-1122 real)", () => {
  const r = escolherMelhorLance([lance({ id: "alto", bid_amount: 4999.97 }), lance({ id: "certo", bid_amount: 220 })]);
  assert.equal(r!.melhor.id, "certo");
  assert.equal(r!.ordenados.length, 2, "o leque inteiro vai na nota");
});

test("empate vai para quem respondeu primeiro", () => {
  const r = escolherMelhorLance([
    lance({ id: "tarde", bid_amount: 300, created_at: "2026-09-08T18:00:00Z" }),
    lance({ id: "cedo", bid_amount: 300, created_at: "2026-09-08T09:00:00Z" }),
  ]);
  assert.equal(r!.melhor.id, "cedo");
});

test("lance nao submetido e valor invalido sao descartados com motivo", () => {
  const r = escolherMelhorLance([
    lance({ id: "rascunho", bid_amount: 10, status: "draft" }),
    lance({ id: "zero", bid_amount: 0 }),
    lance({ id: "texto", bid_amount: "abc" }),
    lance({ id: "bom", bid_amount: 400 }),
  ]);
  assert.equal(r!.melhor.id, "bom");
  assert.equal(r!.descartados.length, 3);
  assert.deepEqual(r!.descartados.map((d) => d.motivo).sort(), ["nao_submetido", "valor_invalido", "valor_invalido"]);
});

test("sem lance valido nao ha escolha, e nao ha rascunho", () => {
  assert.equal(escolherMelhorLance([]), null);
  assert.equal(escolherMelhorLance([lance({ id: "x", status: "withdrawn" })]), null);
});

test("bid_amount como string do banco continua valendo", () => {
  const r = escolherMelhorLance([lance({ id: "s", bid_amount: "380.00" })]);
  assert.equal(r!.precoAoCliente, 633.33);
});
