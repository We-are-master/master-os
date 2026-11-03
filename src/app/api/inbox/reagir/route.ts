/**
 * Reação pela tela /inbox: o 7983 reage à mensagem (uazapi `/message/react`) e
 * a reação entra em `wa_mensagens` como `tipo: reaction`, com a mensagem alvo em
 * `bruto.reaction`, igual ao que o webhook grava quando o contato reage. A tela
 * pendura o emoji no balão; emoji vazio tira a reação.
 */

import { NextRequest, NextResponse } from "next/server";
import { staffDaInbox } from "@/lib/inbox/staff";
import { EnvioOperacaoError, OPS_PHONE_NUMBER_ID } from "@/lib/whatsapp/operacao";
import { provedorDaOperacao, reagirPelaUazapi } from "@/lib/whatsapp/uazapi-operacao";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const s = await staffDaInbox();
  if (s instanceof NextResponse) return s;
  const { sb } = s;
  if (provedorDaOperacao() !== "uazapi") return NextResponse.json({ error: "Reactions go out only through the uazapi number" }, { status: 400 });

  const corpo = (await req.json().catch(() => ({}))) as { contato?: string; wamid?: string; emoji?: string };
  const contato = String(corpo.contato ?? "").replace(/\D/g, "");
  const alvo = String(corpo.wamid ?? "").trim();
  const emoji = String(corpo.emoji ?? "").trim().slice(0, 16);
  if (!contato || !alvo) return NextResponse.json({ error: "contato and wamid are required" }, { status: 400 });

  // A mensagem tem que ser desta conversa: não reage a id solto.
  const { data: existe } = await sb
    .from("wa_mensagens")
    .select("id")
    .eq("phone_number_id", OPS_PHONE_NUMBER_ID())
    .eq("contato", contato)
    .eq("wamid", alvo)
    .limit(1)
    .maybeSingle();
  if (!existe) return NextResponse.json({ error: "Message not found" }, { status: 404 });

  try {
    const { wamid } = await reagirPelaUazapi(contato, alvo, emoji);
    const { error } = await sb.from("wa_mensagens").insert({
      wamid: wamid ?? `reacao-${alvo}-${Date.now()}`,
      phone_number_id: OPS_PHONE_NUMBER_ID(),
      contato,
      direcao: "saida",
      origem: "os",
      tipo: "reaction",
      texto: emoji || null,
      status: "sent",
      enviado_por: s.userId,
      enviado_por_nome: s.nome,
      bruto: { reaction: alvo },
    });
    if (error) console.error("[inbox-reagir] gravar", error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof EnvioOperacaoError ? e.message : "Could not react";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
