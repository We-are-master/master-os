/**
 * Salva os ajustes do Harvey (tela /agents/harvey): janela dos templates,
 * 5+ quartos e transferência bancária. Só admin e manager. Vale em até 30 s.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { CHAVE_DOS_AJUSTES, validarAjustes } from "@/lib/harvey-wa/ajustes";

export const dynamic = "force-dynamic";

const EDITA = new Set(["admin", "manager"]);

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const sb = createServiceClient();
  const { data: eu } = await sb.from("profiles").select("role, full_name, email").eq("id", auth.user.id).maybeSingle();
  if (!EDITA.has(String(eu?.role ?? ""))) return NextResponse.json({ error: "Only admins and managers can change Harvey's settings" }, { status: 403 });

  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const inicio = Number(corpo.janelaInicio);
  const fim = Number(corpo.janelaFim);
  if (!Number.isInteger(inicio) || !Number.isInteger(fim) || inicio < 0 || fim > 24 || fim <= inicio) {
    return NextResponse.json({ error: "The start hour must be before the end hour" }, { status: 400 });
  }
  const ajustes = validarAjustes({ ...corpo, janelaInicio: inicio, janelaFim: fim });
  const { error } = await sb.from("harvey_wa_config").upsert({
    chave: CHAVE_DOS_AJUSTES,
    valor: ajustes,
    atualizado_em: new Date().toISOString(),
    atualizado_por: String(eu?.full_name || eu?.email || "team"),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ajustes });
}
