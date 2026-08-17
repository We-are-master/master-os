/**
 * O price-check do orçamentista: pedido em texto livre entra, quote fechada
 * sai — labour aprovado do pricebook + kit de material comprado do mais
 * barato e vendido pela média, com o link de prova de cada preço.
 *
 * A divisão de poderes é a regra da casa: a IA (matcher) só aponta linhas
 * que existem; a conta é do quote-engine, puro e testado; e os guardas
 * (elétrica recusada, draft não cota, job mínimo) são código, não prompt.
 *
 * Quem chama: a aba Quote do dashboard (sessão) e, em breve, Mike e o agente
 * do Zendesk (x-api-key, o mesmo padrão do endpoint do Express).
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuth } from "@/lib/auth-api";
import { matchRequest } from "@/lib/orcamentista/matcher";
import {
  montarQuote,
  textoApresentavel,
  type ItemKit,
  type LinhaPricebook,
} from "@/lib/orcamentista/quote-engine";
import type { SupplierPriceFact } from "@/lib/orcamentista/material-math";

export const dynamic = "force-dynamic";

async function autorizado(req: NextRequest): Promise<boolean> {
  const key = req.headers.get("x-api-key")?.trim();
  const esperada = process.env.MASTER_OS_JOB_WEBHOOK_API_KEY?.trim();
  if (esperada && key === esperada) return true;
  const auth = await requireAuth();
  return !(auth instanceof NextResponse);
}

export async function POST(req: NextRequest) {
  if (!(await autorizado(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not set — the matcher cannot run" },
      { status: 500 },
    );
  }

  let pedido = "";
  try {
    const body = (await req.json()) as { request?: string };
    pedido = String(body.request ?? "").trim();
  } catch {
    /* cai no 422 abaixo */
  }
  if (pedido.length < 3) {
    return NextResponse.json(
      { error: "send { request: \"what the customer wants\" }" },
      { status: 422 },
    );
  }

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
  if (falha) {
    return NextResponse.json(
      { error: `pricing tables not ready: ${falha.message} — apply migrations 253/255/256` },
      { status: 500 },
    );
  }

  const pricebook = (pricebookRes.data ?? []) as LinhaPricebook[];
  const kits = (kitsRes.data ?? []) as ItemKit[];
  const fornecedores = (fornecedoresRes.data ?? []) as SupplierPriceFact[];

  let match;
  try {
    match = await matchRequest(
      pedido,
      pricebook.map((l) => ({ trade: l.trade, service: l.service, unit: l.unit })),
      apiKey,
    );
  } catch (err) {
    return NextResponse.json(
      { error: `matcher failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  const quote = montarQuote(match.matches, pricebook, kits, fornecedores);

  // O que a IA não conseguiu apontar entra na quote como pendência declarada.
  for (const item of match.cannotPrice) {
    quote.gaps.push(
      match.electricalWorkRequested && /electri|socket|light|rewir|fuse|charger/i.test(item)
        ? `"${item}" — electrical installation is not offered (certificates only, owner rule 17/08).`
        : `"${item}" — not in the pricebook, needs a human quote.`,
    );
  }

  return NextResponse.json({
    request: pedido,
    quote,
    presentable: textoApresentavel(quote),
    electrical_work_requested: match.electricalWorkRequested,
  });
}
