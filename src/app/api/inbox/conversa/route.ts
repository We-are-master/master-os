/**
 * Estado de uma conversa da /inbox: resolver, reabrir, arquivar, excluir,
 * restaurar e as tags (que são as views da lateral). Resolvida e excluída
 * voltam sozinhas quando o contato escreve depois (a tela compara com a última
 * entrada); arquivada fica arquivada. Excluir não apaga mensagem nenhuma.
 */

import { NextRequest, NextResponse } from "next/server";
import { staffDaInbox } from "@/lib/inbox/staff";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const s = await staffDaInbox();
  if (s instanceof NextResponse) return s;
  const corpo = (await req.json().catch(() => ({}))) as { contato?: string; acao?: string; tags?: unknown };
  const contato = String(corpo.contato ?? "").replace(/\D/g, "");
  if (!contato) return NextResponse.json({ error: "contato is required" }, { status: 400 });

  const agora = new Date().toISOString();
  let patch: Record<string, unknown>;
  if (corpo.acao === "resolver") patch = { resolvida_em: agora, resolvida_por: s.userId };
  else if (corpo.acao === "reabrir") patch = { resolvida_em: null, resolvida_por: null };
  else if (corpo.acao === "arquivar") patch = { arquivada_em: agora, excluida_em: null };
  else if (corpo.acao === "excluir") patch = { excluida_em: agora, arquivada_em: null };
  else if (corpo.acao === "restaurar") patch = { arquivada_em: null, excluida_em: null };
  else if (corpo.acao === "ler") patch = { lida_em: agora, nao_lida: false };
  else if (corpo.acao === "nao_ler") patch = { nao_lida: true };
  else if (corpo.acao === "fixar") patch = { fixada_em: agora };
  else if (corpo.acao === "desafixar") patch = { fixada_em: null };
  else if (corpo.acao === "tags" && Array.isArray(corpo.tags)) {
    patch = { tags: [...new Set(corpo.tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 20) };
  } else return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const { data, error } = await s.sb
    .from("inbox_conversas")
    .upsert({ contato, ...patch, atualizado_em: agora }, { onConflict: "contato" })
    .select("contato, resolvida_em, arquivada_em, excluida_em, tags, lida_em, nao_lida, fixada_em")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, conversa: data });
}
