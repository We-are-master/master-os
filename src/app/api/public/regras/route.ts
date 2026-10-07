import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { versaoEmVigor, type Regras } from "@/lib/os-documentos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/public/regras: só as regras de CLIENTE (termos, FAQ do site). Parceiro e conta ficam no OS. */
export async function GET() {
  try {
    const v = await versaoEmVigor<Regras>(createServiceClient(), "regras");
    if (!v) return NextResponse.json({ error: "No rules yet" }, { status: 404 });
    return NextResponse.json(
      { versao: v.id, atualizado_em: v.criado_em, cliente: v.documento.publicos.cliente ?? [] },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (err) {
    console.error("[api/public/regras]", err);
    return NextResponse.json({ error: "Could not load the rules" }, { status: 500 });
  }
}
