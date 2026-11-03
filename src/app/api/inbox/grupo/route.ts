/**
 * New group da /inbox: cria o grupo no 7983 pela uazapi e já grava o nome na
 * caixa. A primeira mensagem, se houver, a tela manda depois pelo /send, que
 * é o mesmo caminho de qualquer conversa. Com `acao: "info"`, devolve os
 * dados do grupo (membros, admins, descrição) para o painel da direita.
 */

import { NextRequest, NextResponse } from "next/server";
import { staffDaInbox } from "@/lib/inbox/staff";
import { EnvioOperacaoError } from "@/lib/whatsapp/operacao";
import { criarGrupoNaUazapi, infoDoGrupoNaUazapi, provedorDaOperacao } from "@/lib/whatsapp/uazapi-operacao";
import { ehGrupo } from "@/lib/inbox/grupo";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const s = await staffDaInbox();
  if (s instanceof NextResponse) return s;
  if (provedorDaOperacao() !== "uazapi") return NextResponse.json({ error: "Groups need the uazapi number" }, { status: 400 });

  const corpo = (await req.json().catch(() => ({}))) as { nome?: unknown; participantes?: unknown; acao?: unknown; contato?: unknown };
  // Info do grupo para o painel da direita (membros, admin, descrição): só leitura.
  if (corpo.acao === "info") {
    const contato = String(corpo.contato ?? "").replace(/\D/g, "");
    if (!ehGrupo(contato)) return NextResponse.json({ error: "Not a group" }, { status: 400 });
    try {
      return NextResponse.json(await infoDoGrupoNaUazapi(contato));
    } catch (e) {
      return NextResponse.json({ error: e instanceof EnvioOperacaoError ? e.message : "Could not load the group" }, { status: 502 });
    }
  }
  const nome = String(corpo.nome ?? "").trim().slice(0, 100);
  const participantes = [...new Set((Array.isArray(corpo.participantes) ? corpo.participantes : []).map((p) => String(p).replace(/\D/g, "")).filter((p) => p.length >= 10 && p.length <= 15))];
  if (!nome) return NextResponse.json({ error: "Name the group" }, { status: 400 });
  if (!participantes.length) return NextResponse.json({ error: "Add at least one person" }, { status: 400 });

  try {
    const { contato, falharam } = await criarGrupoNaUazapi(nome, participantes);
    const { error } = await s.sb.from("inbox_conversas").upsert({ contato, nome }, { onConflict: "contato" });
    if (error) console.error("[inbox/grupo] nome", error.message);
    return NextResponse.json({ contato, nome, falharam });
  } catch (e) {
    return NextResponse.json({ error: e instanceof EnvioOperacaoError ? e.message : "Could not create the group" }, { status: 502 });
  }
}
