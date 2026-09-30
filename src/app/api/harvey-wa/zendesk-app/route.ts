/**
 * O app "Harvey WhatsApp" na barra lateral do ticket no Zendesk (pasta
 * zendesk-app/harvey-wa). O Zendesk trava o ticket enquanto o Harvey está com a
 * conversa; o app fica de fora da trava e chama esta rota.
 *
 *   GET  ?lista=1                            → conversas dos últimos 3 dias (barra superior)
 *   GET  ?ticket=123                         → com quem está a conversa do ticket (barra lateral)
 *   POST { conversationId | ticket, acao: assumir|devolver, agente }
 *   POST { acao: pausar|ligar, agente }      → interruptor geral, igual ao do OS
 *
 * O Zendesk esconde a barra lateral nos tickets travados do Harvey; por isso o
 * app também fica na barra superior, que aparece sempre.
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

/**
 * Confere o token. Quando recusa, diz o motivo (sem mostrar nenhuma senha) para
 * dar para achar o problema pela tela do Zendesk: variável ausente no deploy,
 * Zendesk sem mandar a senha, ou senhas diferentes (com o tamanho de cada uma).
 */
function recusa(req: NextRequest): NextResponse | null {
  // trim: o `openssl rand -hex 32 | pbcopy` leva uma quebra de linha que a Vercel guarda e o Zendesk não.
  const esperado = (process.env.HARVEY_WA_ZENDESK_APP_TOKEN ?? "").trim();
  const veio = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  let motivo: string | null = null;
  if (!esperado) motivo = "HARVEY_WA_ZENDESK_APP_TOKEN is not set on this deployment";
  else if (!veio) motivo = "Zendesk sent no token";
  else if (veio.includes("{{")) motivo = "Zendesk did not fill in the token (secure setting missing)";
  else {
    const a = Buffer.from(veio);
    const b = Buffer.from(esperado);
    if (a.length !== b.length || !timingSafeEqual(a, b)) motivo = `Token does not match (Zendesk ${a.length} chars, Vercel ${b.length} chars)`;
  }
  return motivo ? NextResponse.json({ error: `Unauthorized: ${motivo}` }, { status: 401 }) : null;
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

// Lista da barra superior: as conversas dos últimos 3 dias, a mais recente primeiro.
async function lista() {
  const sb = createServiceClient();
  const desde = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const [{ data: conversas, error }, { data: pausa }] = await Promise.all([
    sb.from("harvey_wa_conversas").select("conversation_id, name, phone, estado, tipo, atualizado_em").gte("atualizado_em", desde).order("atualizado_em", { ascending: false }).limit(60),
    sb.from("harvey_wa_config").select("valor").eq("chave", "pausado").maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  return { conversas: conversas ?? [], pausado: pausa?.valor === true };
}

export async function GET(req: NextRequest) {
  const negado = recusa(req);
  if (negado) return negado;
  try {
    if (req.nextUrl.searchParams.get("lista")) return NextResponse.json(await lista());
    const ticket = numeroDoTicket(req.nextUrl.searchParams.get("ticket"));
    if (!ticket) return NextResponse.json({ error: "ticket is required" }, { status: 400 });
    const { conversa, pausado } = await situacao(ticket);
    return NextResponse.json({ encontrada: !!conversa, estado: conversa?.estado ?? null, nome: conversa?.name ?? null, pausado });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const negado = recusa(req);
  if (negado) return negado;
  const corpo = (await req.json().catch(() => ({}))) as { ticket?: unknown; conversationId?: string; acao?: string; agente?: string };
  const quem = String(corpo.agente ?? "").trim().slice(0, 80) || "team";
  try {
    const sb = createServiceClient();
    if (corpo.acao === "pausar" || corpo.acao === "ligar") {
      const { error } = await sb.from("harvey_wa_config").upsert({ chave: "pausado", valor: corpo.acao === "pausar", atualizado_em: new Date().toISOString(), atualizado_por: `${quem} (Zendesk)` });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, pausado: corpo.acao === "pausar" });
    }
    // A barra superior manda a conversa; a barra lateral do ticket, o número do ticket.
    let id = String(corpo.conversationId ?? "");
    if (!id) {
      const ticket = numeroDoTicket(corpo.ticket);
      if (!ticket) return NextResponse.json({ error: "ticket or conversationId is required" }, { status: 400 });
      id = (await conversaDoTicket(sb, ticket))?.conversation_id ?? "";
      if (!id) return NextResponse.json({ error: "No Harvey conversation for this ticket" }, { status: 404 });
    }
    if (corpo.acao === "assumir") {
      await assumirConversa(sb, id, quem, "Zendesk");
      return NextResponse.json({ ok: true, estado: "equipe" });
    }
    if (corpo.acao === "devolver") {
      await devolverConversa(sb, id);
      return NextResponse.json({ ok: true, estado: "harvey" });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
