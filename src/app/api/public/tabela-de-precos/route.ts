import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { versaoEmVigor, type TabelaDePrecos } from "@/lib/os-documentos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/public/tabela-de-precos: a tabela de preços em vigor, que o site
 * (vitrine e checkout) e o Harvey leem ao vivo. Sem login. O site guarda a
 * dele embutida como reserva, então erro aqui nunca para uma venda.
 */
export async function GET() {
  try {
    const v = await versaoEmVigor<TabelaDePrecos>(createServiceClient(), "tabela_de_precos");
    if (!v) return NextResponse.json({ error: "No price list yet" }, { status: 404 });
    return NextResponse.json(
      { versao: v.id, atualizado_em: v.criado_em, documento: v.documento },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (err) {
    console.error("[api/public/tabela-de-precos]", err);
    return NextResponse.json({ error: "Could not load the price list" }, { status: 500 });
  }
}
