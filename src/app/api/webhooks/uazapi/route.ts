/**
 * Entrada do 7983 pela uazapi (src/lib/whatsapp/uazapi-operacao.ts). A URL
 * cadastrada na instância é `/api/webhooks/uazapi?k=<UAZAPI_OPS_WEBHOOK_SECRET>`.
 * Sem a chave certa, 403. Com ela, sempre 200, mesmo quando a mensagem é
 * pulada ou o corpo não se lê: senão a uazapi reentrega em laço.
 *
 * Com HARVEY_TRIAGEM_7983=1 a mensagem de cliente gravada vai para a triagem do
 * Harvey depois da resposta (harvey/triagem-7983.ts). Sem a flag, nada muda.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { agendarTriagem7983 } from "@/lib/harvey/triagem-7983";
import { chaveUazapiOk, gravarEventoUazapi } from "@/lib/whatsapp/uazapi-operacao";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!chaveUazapiOk(req.nextUrl.searchParams.get("k"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const payload = await req.json().catch(() => null);
  if (!payload) return NextResponse.json({ ok: true, resultado: "corpo ilegível" });
  const sb = createServiceClient();
  const resultado = await gravarEventoUazapi(sb, payload);
  await agendarTriagem7983(sb, payload, resultado);
  return NextResponse.json({ ok: true, resultado });
}
