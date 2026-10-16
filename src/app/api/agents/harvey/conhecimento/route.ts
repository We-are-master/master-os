/**
 * Edita o que o Harvey sabe e decide (tela /agents/harvey).
 *
 *   { perfil, id, texto }      salva o texto do bloco (guarda o anterior para desfazer)
 *   { perfil, id, acao: "reset" }   volta ao padrão do código
 *   { perfil, id, acao: "desfazer" } volta para o texto anterior
 *
 * Só admin e manager: o texto vira instrução do Harvey para todo cliente.
 * O cérebro relê em até 30 segundos (conhecimento.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { chaveDaSecao, lerEdicoes } from "@/lib/harvey-wa/conhecimento";
import { secoesDo, type PerfilDoHarvey } from "@/lib/harvey-wa/prompt";

export const dynamic = "force-dynamic";

const EDITA = new Set(["admin", "manager"]);
const MAX = 8000;

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const sb = createServiceClient();
  const { data: eu } = await sb.from("profiles").select("role, full_name, email").eq("id", auth.user.id).maybeSingle();
  if (!EDITA.has(String(eu?.role ?? ""))) return NextResponse.json({ error: "Only admins and managers can edit Harvey" }, { status: 403 });
  const quem = String(eu?.full_name || eu?.email || "team");

  const corpo = (await req.json().catch(() => ({}))) as { perfil?: string; id?: string; texto?: string; acao?: string };
  const perfil: PerfilDoHarvey = corpo.perfil === "parceiro" ? "parceiro" : "cliente";
  const secao = secoesDo(perfil).find((s) => s.id === corpo.id);
  if (!secao) return NextResponse.json({ error: "Unknown section" }, { status: 400 });
  const chave = chaveDaSecao(perfil, secao.id);
  const atual = (await lerEdicoes(sb, perfil))[secao.id];
  const agora = new Date().toISOString();

  if (corpo.acao === "reset") {
    const { error } = await sb.from("harvey_wa_config").delete().eq("chave", chave);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, texto: secao.texto, editado: false });
  }

  let texto: string;
  if (corpo.acao === "desfazer") {
    if (!atual?.anterior) return NextResponse.json({ error: "Nothing to undo" }, { status: 400 });
    texto = atual.anterior;
  } else {
    texto = String(corpo.texto ?? "").replace(/\r\n/g, "\n").trim();
    if (!texto) return NextResponse.json({ error: "The text is empty. Use Reset to default instead." }, { status: 400 });
    if (texto.length > MAX) return NextResponse.json({ error: `Too long (${texto.length} characters, max ${MAX})` }, { status: 400 });
  }
  // Igual ao padrão: não guarda edição nenhuma.
  if (texto === secao.texto.trim()) {
    await sb.from("harvey_wa_config").delete().eq("chave", chave);
    return NextResponse.json({ ok: true, texto, editado: false });
  }
  const anterior = atual?.texto ?? secao.texto;
  const { error } = await sb.from("harvey_wa_config").upsert({ chave, valor: { texto, anterior }, atualizado_em: agora, atualizado_por: quem });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, texto, editado: true, atualizado_por: quem, atualizado_em: agora });
}
