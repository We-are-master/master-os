/**
 * Editar para todos pela tela /inbox: o 7983 edita a mensagem (uazapi
 * `/message/edit`) e a linha de `wa_mensagens` recebe o texto novo, com a
 * edição carimbada em `bruto.editado_em`. Regras do WhatsApp: só mensagem
 * nossa, só texto, só nos primeiros 15 minutos.
 */

import { NextRequest, NextResponse } from "next/server";
import { staffDaInbox } from "@/lib/inbox/staff";
import { EnvioOperacaoError, OPS_PHONE_NUMBER_ID } from "@/lib/whatsapp/operacao";
import { aplicarEdicao, editarPelaUazapi, provedorDaOperacao } from "@/lib/whatsapp/uazapi-operacao";

export const dynamic = "force-dynamic";

/** O WhatsApp aceita edição até 15 minutos; um minuto de folga para o relógio. */
const JANELA_DE_EDICAO_MS = 15 * 60_000;

export async function POST(req: NextRequest) {
  const s = await staffDaInbox();
  if (s instanceof NextResponse) return s;
  const { sb } = s;
  if (provedorDaOperacao() !== "uazapi") return NextResponse.json({ error: "Edits go out only through the uazapi number" }, { status: 400 });

  const corpo = (await req.json().catch(() => ({}))) as { contato?: string; wamid?: string; texto?: string };
  const contato = String(corpo.contato ?? "").replace(/\D/g, "");
  const alvo = String(corpo.wamid ?? "").trim();
  const texto = String(corpo.texto ?? "").trim();
  if (!contato || !alvo) return NextResponse.json({ error: "contato and wamid are required" }, { status: 400 });
  if (!texto) return NextResponse.json({ error: "The message can't be empty" }, { status: 400 });
  if (texto.length > 4096) return NextResponse.json({ error: "Message too long" }, { status: 400 });

  // A mensagem tem que ser desta conversa, nossa e de texto.
  const { data: linha } = await sb
    .from("wa_mensagens")
    .select("id, texto, bruto, direcao, tipo, criado_em")
    .eq("phone_number_id", OPS_PHONE_NUMBER_ID())
    .eq("contato", contato)
    .eq("wamid", alvo)
    .limit(1)
    .maybeSingle();
  if (!linha) return NextResponse.json({ error: "Message not found" }, { status: 404 });
  if (linha.direcao !== "saida" || linha.tipo !== "text") return NextResponse.json({ error: "Only our own text messages can be edited" }, { status: 400 });
  if (Date.now() - Date.parse(linha.criado_em as string) > JANELA_DE_EDICAO_MS) {
    return NextResponse.json({ error: "WhatsApp only allows edits in the first 15 minutes" }, { status: 400 });
  }
  if ((linha.texto ?? "") === texto) return NextResponse.json({ ok: true });

  try {
    await editarPelaUazapi(alvo, texto);
  } catch (e) {
    const msg = e instanceof EnvioOperacaoError ? e.message : "Could not edit";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  try {
    await aplicarEdicao(sb, linha as { id: string; texto: string | null; bruto: Record<string, unknown> | null }, texto, s.nome);
  } catch (e) {
    // Já foi editada no WhatsApp; só o espelho falhou. O eco do webhook ainda acerta a linha.
    console.error("[inbox-editar] gravar", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true });
}
