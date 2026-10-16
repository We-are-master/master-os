/**
 * GET /api/services/website-items: os ids das variações e extras de Services
 * que o site vende (o mapa do site, os_documentos v3). A tela de Services usa
 * para mostrar "On website" e não deixar apagar ou zerar esses itens.
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { versaoAtual } from "@/lib/os-documentos";
import { idsNoSite, type MapaDoSite } from "@/lib/servicos-do-site";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const v = await versaoAtual<{ formato: number; mapa?: MapaDoSite }>(createServiceClient(), "tabela_de_precos").catch(() => null);
  const ids = v?.documento.formato === 3 && v.documento.mapa ? idsNoSite(v.documento.mapa) : [];
  return NextResponse.json({ ids });
}
