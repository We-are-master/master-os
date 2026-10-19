/**
 * Salva o que o Harvey faz sozinho (tela /agents/harvey, bloco Autonomy) e as
 * regras do negócio que ele lê. Pausar tudo pode qualquer pessoa da equipe;
 * mudar área, teto ou regras só admin e manager. Vale em até 30 s, sem deploy.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { CHAVE_DA_AUTONOMIA, lerAutonomia, validarAutonomia } from "@/lib/harvey/autonomia";
import { CHAVE_DAS_REGRAS } from "@/lib/harvey/regras-do-negocio";

export const dynamic = "force-dynamic";

const EQUIPE = new Set(["admin", "manager", "operator"]);
const EDITA = new Set(["admin", "manager"]);

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const sb = createServiceClient();
  const { data: eu } = await sb.from("profiles").select("role, full_name, email").eq("id", auth.user.id).maybeSingle();
  const papel = String(eu?.role ?? "");
  if (!EQUIPE.has(papel)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const quem = String(eu?.full_name || eu?.email || "team");
  const agora = new Date().toISOString();

  const corpo = (await req.json().catch(() => ({}))) as { acao?: string; autonomia?: unknown; regras?: unknown };

  // Botão grande: só liga ou desliga o geral, mantendo o resto como está.
  if (corpo.acao === "pausar_tudo" || corpo.acao === "ligar_tudo") {
    const atual = await lerAutonomia(sb);
    const valor = validarAutonomia({ ...atual, geral: corpo.acao === "ligar_tudo" });
    const { error } = await sb.from("harvey_wa_config").upsert({ chave: CHAVE_DA_AUTONOMIA, valor, atualizado_em: agora, atualizado_por: quem });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, autonomia: valor });
  }

  if (!EDITA.has(papel)) return NextResponse.json({ error: "Only admins and managers can change what Harvey does on his own" }, { status: 403 });

  if (corpo.autonomia !== undefined) {
    const valor = validarAutonomia(corpo.autonomia);
    const { error } = await sb.from("harvey_wa_config").upsert({ chave: CHAVE_DA_AUTONOMIA, valor, atualizado_em: agora, atualizado_por: quem });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (corpo.regras !== undefined) {
    const texto = typeof corpo.regras === "string" ? corpo.regras.trim() : "";
    // Vazio volta ao padrão do código.
    const { error } = texto
      ? await sb.from("harvey_wa_config").upsert({ chave: CHAVE_DAS_REGRAS, valor: { texto }, atualizado_em: agora, atualizado_por: quem })
      : await sb.from("harvey_wa_config").delete().eq("chave", CHAVE_DAS_REGRAS);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
