import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveCatalogLinePricing } from "./catalog-line-pricing";
import type { AccountServicePrice, CatalogService } from "@/types/database";

// EoT de 3 quartos na tabela de 22/09 e o tapete, com o combinado da U R
// Certified (lista de 04/09): £306 na faixa e £24 no extra.
const catalogo = {
  id: "eot",
  name: "End of Tenancy Clean",
  pricing_mode: "fixed",
  fixed_price: 200,
  hourly_rate: 0,
  default_hours: null,
  partner_cost: 140,
  pricing_presets: [
    { id: "3b2b", label: "3 bed · 2 bath", sort_order: 50, fixed_price: 360, partner_cost: 223, pricing_mode: "fixed" },
  ],
  pricing_addons: [{ id: "rug", label: "Rug", sort_order: 0, fixed_price: 28, partner_cost: 18 }],
} as unknown as CatalogService;

function conta(allow: boolean): AccountServicePrice {
  return {
    id: "asp",
    account_id: "ur",
    catalog_service_id: "eot",
    use_standard: false,
    allow_below_standard: allow,
    preset_overrides: { "3b2b": { fixed_price: 306 } },
    addon_overrides: { rug: { fixed_price: 24 } },
    created_at: "",
    updated_at: "",
  };
}

describe("resolveCatalogLinePricing com preço combinado", () => {
  it("sem a chave, a tabela vence o combinado mais baixo", () => {
    const r = resolveCatalogLinePricing({
      catalog: catalogo, presetId: "3b2b", addonIds: ["rug"], accountPrice: conta(false), partnerPrice: null,
    });
    assert.ok(r);
    assert.equal(r.clientTotal, 388);
    assert.deepEqual(r.lines.map((l) => l.clientSource), ["standard", "standard"]);
  });

  it("com a chave, vale o combinado na faixa e no extra", () => {
    const r = resolveCatalogLinePricing({
      catalog: catalogo, presetId: "3b2b", addonIds: ["rug"], accountPrice: conta(true), partnerPrice: null,
    });
    assert.ok(r);
    assert.equal(r.clientTotal, 330);
    assert.deepEqual(r.lines.map((l) => l.clientSource), ["custom", "custom"]);
    // O lado do cleaner não muda: continua o custo do catálogo.
    assert.equal(r.partnerTotal, 223 + 18);
  });
});
