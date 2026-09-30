/**
 * O app "Harvey WhatsApp" na barra lateral do ticket no Zendesk (pasta
 * zendesk-app/harvey-wa). O Zendesk trava o ticket enquanto o Harvey está com a
 * conversa; o app fica de fora da trava e chama esta rota.
 *
 *   GET  ?ticket=123                        → com quem está a conversa do ticket
 *   POST { ticket, acao: assumir|devolver, agente }
 *
 * O app chama pelo proxy do Zendesk (`secure: true`): o token fica guardado na
 * instalação do app e nunca chega ao navegador do agente. Aqui ele é conferido
 * contra HARVEY_WA_ZENDESK_APP_TOKEN (Vercel).
 */

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { assumirConversa, conversaDoTicket, devolverConversa } from "@/lib/harvey-wa/controle";

export const dynamic = "force-dynamic";

function autorizado(req: NextRequest): boolean {
  const esperado = process.env.HARVEY_WA_ZENDESK_APP_TOKEN;
  const veio = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!esperado || !veio) return false;
  const a = Buffer.from(veio);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function situacao(ticket: number) {
  const sb = createServiceClient();
  const [conversa, { data: pausa }] = await Promise.all([
    conversaDoTicket(sb, ticket),
    sb.from("harvey_wa_config").select("valor").eq("chave", "pausado").maybeSingle(),
  ]);
  return { sb, conversa, pausado: pausa?.valor === true };
}

const numeroDoTicket = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ticket = numeroDoTicket(req.nextUrl.searchParams.get("ticket"));
  if (!ticket) return NextResponse.json({ error: "ticket is required" }, { status: 400 });
  try {
    const { conversa, pausado } = await situacao(ticket);
    return NextResponse.json({ encontrada: !!conversa, estado: conversa?.estado ?? null, nome: conversa?.name ?? null, pausado });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const corpo = (await req.json().catch(() => ({}))) as { ticket?: unknown; acao?: string; agente?: string };
  const ticket = numeroDoTicket(corpo.ticket);
  if (!ticket) return NextResponse.json({ error: "ticket is required" }, { status: 400 });
  const quem = String(corpo.agente ?? "").trim().slice(0, 80) || "team";
  try {
    const { sb, conversa } = await situacao(ticket);
    if (!conversa) return NextResponse.json({ error: "No Harvey conversation for this ticket" }, { status: 404 });
    if (corpo.acao === "assumir") {
      await assumirConversa(sb, conversa.conversation_id, quem, "Zendesk");
      return NextResponse.json({ ok: true, estado: "equipe" });
    }
    if (corpo.acao === "devolver") {
      await devolverConversa(sb, conversa.conversation_id);
      return NextResponse.json({ ok: true, estado: "harvey" });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
