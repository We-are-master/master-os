import { test } from "node:test";
import assert from "node:assert/strict";
import { checklistDoJob, prontoParaJob } from "./pronto-para-job";
import { etapaPelasQuotes } from "./lead-servidor";
import { janelaDoTexto } from "../inbox/prefill";

const leadCompleto = {
  client_id: "c1",
  address: "14 Elm Road",
  postcode: "W5 2AB",
  in_ccz: false,
  has_free_parking: true,
  catalog_service_id: "s1",
  scope: "Replace kitchen mixer tap and reseal sink edge.",
  preferred_date: "2026-11-11",
  preferred_window: "08:00-10:00",
  price_given: null,
  price_mode: null,
  external_ref: "48213",
  account_id: "a1",
};

test("lead completo com quote paga está pronto", () => {
  const itens = checklistDoJob({
    lead: leadCompleto,
    quote: { sell_price: 540, total_value: 540, partner_cost: 360, cost: 360, customer_deposit_paid: true, deposit_required: 270, status: "awaiting_payment" },
  });
  assert.deepEqual(prontoParaJob(itens), { pronto: true, faltam: 0, total: 11 });
});

test("faltam data, CCZ e entrada", () => {
  const itens = checklistDoJob({
    lead: { ...leadCompleto, preferred_date: null, in_ccz: null },
    quote: { sell_price: 540, total_value: 540, partner_cost: 360, cost: 360, customer_deposit_paid: false, deposit_required: 270, status: "awaiting_payment" },
  });
  const faltando = itens.filter((i) => !i.ok).map((i) => i.key);
  assert.deepEqual(faltando, ["ccz_parking", "date_window", "deposit"]);
});

test("preço no scope não passa", () => {
  const itens = checklistDoJob({ lead: { ...leadCompleto, scope: "Fix tap. Price: £180" }, entradaPaga: true });
  assert.equal(itens.find((i) => i.key === "scope")?.ok, false);
});

test("preço de handyman sem quote serve de preço e custo", () => {
  const itens = checklistDoJob({ lead: { ...leadCompleto, price_given: 180, price_mode: "half_day" }, entradaPaga: true });
  assert.equal(prontoParaJob(itens).pronto, true);
});

test("conta sem entrada não pede pagamento", () => {
  const itens = checklistDoJob({ lead: { ...leadCompleto, price_given: 72, price_mode: "hourly" }, semEntrada: true });
  assert.equal(itens.find((i) => i.key === "deposit")?.ok, true);
});

test("quote mais avançada decide a etapa", () => {
  assert.equal(etapaPelasQuotes([]), null);
  assert.equal(etapaPelasQuotes(["bidding"]), "quoting");
  assert.equal(etapaPelasQuotes(["rejected", "awaiting_customer"]), "quoted");
  assert.equal(etapaPelasQuotes(["awaiting_payment", "bidding"]), "quoted");
  assert.equal(etapaPelasQuotes(["rejected", "rejected"]), "lost");
  assert.equal(etapaPelasQuotes(["converted_to_job"]), "won");
});

test("janela de chegada em texto vira início e minutos", () => {
  assert.deepEqual(janelaDoTexto("08:00-10:00"), { from: "08:00", mins: 120 });
  assert.deepEqual(janelaDoTexto("8 to 10:30"), { from: "08:00", mins: 150 });
  assert.equal(janelaDoTexto("morning"), null);
  assert.equal(janelaDoTexto("10-08"), null);
});
