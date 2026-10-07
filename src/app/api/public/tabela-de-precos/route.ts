import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { versaoEmVigor, type TabelaDePrecos } from "@/lib/os-documentos";
import { gerarTabelaDoSite, lerServicos, type MapaDoSite, type TabelaDoSite } from "@/lib/servicos-do-site";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Layout = { formato: 3; layout: TabelaDePrecos; mapa: MapaDoSite };
let cache: { em: number; versao: number; tabela: TabelaDoSite } | null = null;

/**
 * GET /api/public/tabela-de-precos: a tabela que o site (vitrine e checkout) e
 * o Harvey leem, GERADA de Services (preço cobrado e pago de cada item que o
 * site já vende) com os textos do layout. Sem login. Cache de 60 s. Se Services
 * não fecha com o mapa (item apagado, preço vazio), responde 503 e o site fica
 * com a última tabela boa: nunca para uma venda.
 */
export async function GET() {
  try {
    if (!cache || Date.now() - cache.em > 60_000) {
      const sb = createServiceClient();
      const v = await versaoEmVigor<Layout>(sb, "tabela_de_precos");
      if (!v || v.documento.formato !== 3) return NextResponse.json({ error: "No site layout yet" }, { status: 404 });
      const tabela = gerarTabelaDoSite(v.documento.layout, v.documento.mapa, await lerServicos(sb));
      cache = { em: Date.now(), versao: v.id, tabela };
    }
    return NextResponse.json(
      { versao: cache.versao, atualizado_em: new Date(cache.em).toISOString(), documento: cache.tabela },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (err) {
    console.error("[api/public/tabela-de-precos]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not build the price list" }, { status: 503 });
  }
}
