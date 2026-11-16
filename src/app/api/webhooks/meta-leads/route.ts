/**
 * Webhook da página da Fixfy (campo `leadgen`): formulário instantâneo da Meta.
 *
 * A Meta manda só o id do lead; aqui o OS busca os campos e faz a entrada toda
 * (src/lib/meta/formulario.ts): cliente, WhatsApp de boas-vindas, ticket, CRM.
 * Tudo é aguardado antes da resposta: na Vercel, promessa solta depois da
 * resposta morre. Reenvio da Meta não duplica (trava pelo leadgen_id).
 *
 * Cadastro no app da Meta: Webhooks → Page → leadgen, URL
 * https://app.getfixfy.com/api/webhooks/meta-leads, token META_LEADS_VERIFY_TOKEN
 * (sem ela vale o WHATSAPP_VERIFY_TOKEN). Assinatura conferida com
 * META_APP_SECRET (sem ela, WHATSAPP_APP_SECRET).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buscarLeadNaMeta, idsDoWebhook, receberLeadDoFormulario } from "@/lib/meta/formulario";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const esperado = (process.env.META_LEADS_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN)?.trim();
  if (p.get("hub.mode") === "subscribe" && esperado && p.get("hub.verify_token") === esperado) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

function assinaturaOk(corpo: string, cabecalho: string | null): boolean {
  const segredo = (process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET)?.trim();
  if (!segredo) return true;
  if (!cabecalho?.startsWith("sha256=")) return false;
  const esperado = Buffer.from("sha256=" + createHmac("sha256", segredo).update(corpo).digest("hex"));
  const recebido = Buffer.from(cabecalho);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}

export async function POST(req: NextRequest) {
  const corpo = await req.text();
  if (!assinaturaOk(corpo, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  let evento: unknown;
  try {
    evento = JSON.parse(corpo);
  } catch {
    return NextResponse.json({ ok: true, ignorado: "json" });
  }

  const sb = createServiceClient();
  const resultados: Array<Record<string, unknown>> = [];
  for (const id of idsDoWebhook(evento)) {
    try {
      const lead = await buscarLeadNaMeta(id);
      const r = await receberLeadDoFormulario(sb, lead);
      console.log(`[meta-form] ${id}:`, JSON.stringify(r));
      resultados.push({ id, ...r });
    } catch (e) {
      // 200 mesmo assim: erro nosso não deve virar reenvio em loop da Meta. Fica no log.
      console.error(`[meta-form] ${id} falhou`, e);
      resultados.push({ id, kind: "falhou", motivo: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ ok: true, resultados });
}
