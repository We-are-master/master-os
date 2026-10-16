/**
 * Vagas por dia e categoria, para o site e o Harvey esconderem o dia cheio.
 *
 *   GET /api/public/capacity?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   → { ligado, dias: [{ data, categorias: { cleaning: { vagas }, ... } }] }
 *
 * A capacidade é a soma da disponibilidade dos parceiros (plano de 29/09/2026).
 * Só vale com CAPACIDADE_LIGADA=1: antes disso a equipe precisa preencher a
 * disponibilidade de cada parceiro, senão todo dia sai com zero vaga e ninguém
 * vende. Desligada, responde `ligado: false` e o site segue como sempre.
 *
 * Público de propósito (só números, nada de nome), com cache de 60 s.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { dataEmLondres, vagasPorDia } from "@/lib/capacity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const ligado = process.env.CAPACIDADE_LIGADA === "1";
  const cabecalhos = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60", "Access-Control-Allow-Origin": "*" };
  if (!ligado) return NextResponse.json({ ligado: false, dias: [] }, { headers: cabecalhos });

  const hoje = dataEmLondres(new Date());
  const de = DATA.test(req.nextUrl.searchParams.get("from") ?? "") ? req.nextUrl.searchParams.get("from")! : hoje;
  const ateParam = req.nextUrl.searchParams.get("to") ?? "";
  const limite = new Date(Date.parse(`${de}T12:00:00Z`) + 45 * 86_400_000).toISOString().slice(0, 10);
  const ate = DATA.test(ateParam) && ateParam <= limite ? ateParam : new Date(Date.parse(`${de}T12:00:00Z`) + 35 * 86_400_000).toISOString().slice(0, 10);

  try {
    const sb = createServiceClient();
    const { data: cats } = await sb.from("service_categories").select("id, slug").eq("is_active", true);
    const slug = new Map((cats ?? []).map((c) => [c.id as string, c.slug as string]));
    const dias = (await vagasPorDia(sb, de, ate, [...slug.keys()])).map((d) => ({
      data: d.data,
      categorias: Object.fromEntries(Object.entries(d.categorias).map(([id, v]) => [slug.get(id) ?? id, { vagas: v.vagas }])),
    }));
    return NextResponse.json({ ligado: true, dias }, { headers: cabecalhos });
  } catch (err) {
    console.error("[public/capacity]", err);
    // Na dúvida, não trava a venda: o checkout confere de novo.
    return NextResponse.json({ ligado: false, dias: [], erro: "indisponível" }, { headers: cabecalhos });
  }
}
