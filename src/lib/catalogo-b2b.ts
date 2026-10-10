/**
 * Tabela de parceiro (Fase 3, dono 09/10/2026): os Services do OS com 5% abaixo do
 * preço de tabela, igual à price list B2B que mandamos à mão. A página pública é
 * /catalog/b2b?for=<empresa>; o Harvey manda o link quando detecta empresa.
 */
import { appBaseUrl } from "@/lib/app-base-url";
import type { CatalogRateCardPayload, CatalogRateCardLine } from "@/lib/catalog-rate-card-core";

export const DESCONTO_B2B_PCT = 5;

function libras(n: number): string {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Todo "£123.45" da string vira o valor com o desconto ("£90/h" → "£85.50/h"). */
export function precoComDesconto(preco: string, pct = DESCONTO_B2B_PCT): string {
  return preco.replace(/£\s?(\d[\d,]*(?:\.\d{1,2})?)/g, (_m, n: string) => {
    const v = Number(n.replace(/,/g, ""));
    return Number.isFinite(v) ? libras(Math.round(v * (100 - pct)) / 100) : _m;
  });
}

export function payloadB2B(payload: CatalogRateCardPayload, pct = DESCONTO_B2B_PCT): CatalogRateCardPayload {
  const linha = (l: CatalogRateCardLine): CatalogRateCardLine => ({ ...l, price: precoComDesconto(l.price, pct) });
  return {
    ...payload,
    categories: payload.categories.map((c) => ({
      ...c,
      services: c.services.map((s) => ({ ...s, lines: s.lines.map(linha), presets: s.presets.map(linha), addons: s.addons.map(linha) })),
    })),
  };
}

/** O nome da empresa que vai no topo da página, sem nada que quebre o layout. */
export function nomeParaTabela(bruto: string | null | undefined): string | null {
  const n = String(bruto ?? "").replace(/[<>"{}]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return n.length >= 2 ? n : null;
}

export function linkDaTabelaB2B(empresa: string | null | undefined): string {
  const nome = nomeParaTabela(empresa);
  return `${appBaseUrl()}/catalog/b2b${nome ? `?for=${encodeURIComponent(nome)}` : ""}`;
}
