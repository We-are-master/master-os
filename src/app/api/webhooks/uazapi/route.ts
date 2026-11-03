/**
 * Entrada do 7983 pela uazapi (src/lib/whatsapp/uazapi-operacao.ts). A URL
 * cadastrada na instância é `/api/webhooks/uazapi?k=<UAZAPI_OPS_WEBHOOK_SECRET>`.
 * Sem a chave certa, 403. Com ela, sempre 200, mesmo quando a mensagem é
 * pulada ou o corpo não se lê: senão a uazapi reentrega em laço.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { chaveUazapiOk, gravarEventoUazapi } from "@/lib/whatsapp/uazapi-operacao";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!chaveUazapiOk(req.nextUrl.searchParams.get("k"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const payload = await req.json().catch(() => null);
  if (!payload) return NextResponse.json({ ok: true, resultado: "corpo ilegível" });
  const resultado = await gravarEventoUazapi(createServiceClient(), payload);
  return NextResponse.json({ ok: true, resultado });
}
