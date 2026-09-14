import { test } from "node:test";
import assert from "node:assert/strict";
import { precoDoParceiroParaOJob } from "./assign-partner-prefill";
import type { CatalogService, PartnerServicePrice } from "@/types/database";

const catalogo = (extra: Partial<CatalogService> = {}) =>
  ({ id: "c1", name: "Painter", pricing_mode: "hourly", partner_cost: 30, default_hours: 2,
     pricing_presets: null, ...extra } as CatalogService);

const acordo = (extra: Partial<PartnerServicePrice> = {}) =>
  ({ id: "p1", partner_id: "x", catalog_service_id: "c1", use_standard: false,
     hourly_partner_rate: null, fixed_partner_cost: null, preset_overrides: null, ...extra } as PartnerServicePrice);

test("sem catálogo não há palpite", () => {
  const r = precoDoParceiroParaOJob({ catalog: null, partnerOverride: acordo() });
  assert.deepEqual(r, { custoFixo: null, valorHora: null, origem: null, faixaIndefinida: false });
});

test("sem acordo do parceiro, vale a tabela padrão", () => {
  // `partner_cost` do catálogo é o TOTAL do serviço; a hora é ele dividido
  // pelas horas padrão. £30 em 2h = £15/h.
  const r = precoDoParceiroParaOJob({ catalog: catalogo(), partnerOverride: null });
  assert.equal(r.valorHora, 15);
  assert.equal(r.origem, "standard");
});

test("o acordo COM ESTE parceiro ganha da tabela", () => {
  const r = precoDoParceiroParaOJob({
    catalog: catalogo(),
    partnerOverride: acordo({ hourly_partner_rate: 46.5 }),
  });
  assert.equal(r.valorHora, 46.5);
  assert.equal(r.origem, "custom", "o escritório precisa saber que é preço dele, não o nosso");
});

test("`use_standard` devolve o parceiro para a tabela, mesmo com valor gravado", () => {
  const r = precoDoParceiroParaOJob({
    catalog: catalogo(),
    partnerOverride: acordo({ use_standard: true, hourly_partner_rate: 99 }),
  });
  assert.equal(r.valorHora, 15);
  assert.equal(r.origem, "standard");
});

test("o total fixo sai da hora vezes as horas do JOB, quando o job as tem", () => {
  const r = precoDoParceiroParaOJob({
    catalog: catalogo(), partnerOverride: acordo({ hourly_partner_rate: 46.5 }), horasDoJob: 3,
  });
  assert.equal(r.custoFixo, 139.5);
});

test("sem horas no job, valem as do catálogo", () => {
  const r = precoDoParceiroParaOJob({
    catalog: catalogo({ default_hours: 2 }), partnerOverride: acordo({ hourly_partner_rate: 46.5 }),
  });
  assert.equal(r.custoFixo, 93);
});

test("sem hora nenhuma o campo fica vazio, e não com um número inventado", () => {
  const r = precoDoParceiroParaOJob({
    catalog: catalogo({ partner_cost: 0, default_hours: 0 }), partnerOverride: acordo(),
  });
  assert.equal(r.custoFixo, null);
  assert.equal(r.valorHora, null);
});

test("centavo, não dízima", () => {
  const r = precoDoParceiroParaOJob({
    catalog: catalogo(), partnerOverride: acordo({ hourly_partner_rate: 33.333 }), horasDoJob: 3,
  });
  assert.equal(r.custoFixo, 100);
  assert.equal(r.valorHora, 33.33);
});

test("parceiro ACIMA do padrão continua sendo acordo dele, não a tabela", () => {
  // O caso em que o escritório mais precisa do aviso: £46,50/h contra um teto
  // de £15/h. Antes o chip dizia "Standard" aqui.
  const r = precoDoParceiroParaOJob({
    catalog: catalogo(), partnerOverride: acordo({ hourly_partner_rate: 46.5 }),
  });
  assert.equal(r.valorHora, 46.5);
  assert.equal(r.origem, "custom");
});

test("uma faixa só, sem preset no job: é ela, sem ambiguidade", () => {
  const r = precoDoParceiroParaOJob({
    catalog: catalogo(),
    partnerOverride: acordo({ preset_overrides: { "faixa-1": { partner_cost: 92 } } as never }),
  });
  assert.equal(r.custoFixo, 92);
  assert.equal(r.origem, "custom");
  assert.equal(r.faixaIndefinida, false);
});

test("duas faixas e nenhum preset: não chuta, avisa", () => {
  // Chutar aqui é escrever um número errado num campo de dinheiro.
  const r = precoDoParceiroParaOJob({
    catalog: catalogo(),
    partnerOverride: acordo({
      preset_overrides: { a: { partner_cost: 67.99 }, b: { partner_cost: 57.99 } } as never,
    }),
  });
  assert.equal(r.custoFixo, null);
  assert.equal(r.origem, null);
  assert.equal(r.faixaIndefinida, true);
});

test("com o preset do job, a faixa certa é escolhida e não há ambiguidade", () => {
  const r = precoDoParceiroParaOJob({
    catalog: catalogo(),
    partnerOverride: acordo({ preset_overrides: { a: { partner_cost: 67.99 }, b: { partner_cost: 57.99 } } as never }),
    presetId: "a",
  });
  assert.equal(r.faixaIndefinida, false);
});

test("faixa com valor inválido não vira preço", () => {
  const r = precoDoParceiroParaOJob({
    catalog: catalogo({ partner_cost: 0, default_hours: 0 }),
    partnerOverride: acordo({ preset_overrides: { a: { partner_cost: 0 } } as never }),
  });
  assert.equal(r.custoFixo, null);
});
