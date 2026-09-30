/**
 * Controle do Harvey no WhatsApp pela equipe (tela /harvey-whatsapp).
 *
 *   assumir  → a conversa vai para o Agent Workspace (o ticket destrava) e o Harvey sai
 *   devolver → a conversa volta para o Harvey
 *   pausar / ligar → interruptor geral: pausado, toda mensagem nova vai para a equipe
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { assumirConversa, devolverConversa } from "@/lib/harvey-wa/controle";

export const dynamic = "force-dynamic";

const STAFF = new Set(["admin", "manager", "operator"]);

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const sb = createServiceClient();
  const { data: perfil } = await sb.from("profiles").select("role, full_name, email").eq("id", auth.user.id).maybeSingle();
  if (!STAFF.has(String(perfil?.role ?? ""))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const quem = String(perfil?.full_name || perfil?.email || "team");

  const corpo = (await req.json().catch(() => ({}))) as { acao?: string; conversationId?: string };
  const agora = new Date().toISOString();

  if (corpo.acao === "pausar" || corpo.acao === "ligar") {
    const { error } = await sb.from("harvey_wa_config").upsert({ chave: "pausado", valor: corpo.acao === "pausar", atualizado_em: agora, atualizado_por: quem });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, pausado: corpo.acao === "pausar" });
  }

  const id = String(corpo.conversationId ?? "");
  if (!id) return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  try {
    if (corpo.acao === "assumir") {
      await assumirConversa(sb, id, quem, "the OS");
      return NextResponse.json({ ok: true, estado: "equipe" });
    }
    if (corpo.acao === "devolver") {
      await devolverConversa(sb, id);
      return NextResponse.json({ ok: true, estado: "harvey" });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
