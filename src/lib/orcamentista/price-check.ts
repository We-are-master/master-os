/**
 * O núcleo do price-check, extraído da rota para ter DOIS consumidores sem
 * duplicar conta: a rota /api/ai/price-check (aba Quote, Mike) e o quoter do
 * Zendesk (que lê o ticket, consolida o pedido e cota igual). Mesmos dados,
 * mesmos guardas, mesma resposta — quem muda é só quem pergunta.
 */
import { createServiceClient } from "@/lib/supabase/service";
import { matchRequest } from "./matcher";
import {
  montarQuote,
  textoApresentavel,
  type ItemKit,
  type LinhaPricebook,
  type QuoteMontada,
} from "./quote-engine";
import type { SupplierPriceFact } from "./material-math";

export type ResultadoPriceCheck = {
  quote: QuoteMontada;
  presentable: string;
  electricalWorkRequested: boolean;
};

export async function executarPriceCheck(pedido: string, escopo?: string): Promise<ResultadoPriceCheck> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set — the matcher cannot run");

  const supabase = createServiceClient();
  const [pricebookRes, kitsRes, fornecedoresRes] = await Promise.all([
    supabase
      .from("service_pricebook")
      .select("trade, service, unit, price_gbp, min_charge_gbp, status, override_gbp")
      .eq("status", "approved"),
    supabase.from("service_material_kits").select("trade, service, family, variant, qty, optional, note"),
    supabase
      .from("supplier_prices")
      .select("id, family, variant, query, supplier, unit_cost, list_price, spec, sample_product, source_url"),
  ]);
  const falha = pricebookRes.error ?? kitsRes.error ?? fornecedoresRes.error;
  if (falha) throw new Error(`pricing tables not ready: ${falha.message} — apply migrations 253/255/256`);

  const pricebook = (pricebookRes.data ?? []) as LinhaPricebook[];
  const kits = (kitsRes.data ?? []) as ItemKit[];
  const fornecedores = (fornecedoresRes.data ?? []) as SupplierPriceFact[];

  const match = await matchRequest(
    pedido,
    pricebook.map((l) => ({ trade: l.trade, service: l.service, unit: l.unit })),
    apiKey,
  );

  const quote = montarQuote(match.matches, pricebook, kits, fornecedores);
  for (const item of match.cannotPrice) {
    quote.gaps.push(
      match.electricalWorkRequested && /electri|socket|light|rewir|fuse|charger/i.test(item)
        ? `"${item}" — electrical installation is not offered (certificates only, owner rule 17/08).`
        : `"${item}" — not in the pricebook, needs a human quote.`,
    );
  }

  return {
    quote,
    presentable: textoApresentavel(quote, escopo ?? pedido),
    electricalWorkRequested: match.electricalWorkRequested,
  };
}
