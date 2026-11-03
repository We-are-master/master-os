/**
 * O painel lateral de Atendimento (o ícone no topo do OS): a mesma caixa da
 * /inbox, enxuta. Sem `contato`, a lista com a última mensagem e o contador;
 * com `contato`, a conversa inteira daquele número.
 */

import { NextRequest, NextResponse } from "next/server";
import { staffDaInbox } from "@/lib/inbox/staff";
import { carregarCaixa } from "@/app/(dashboard)/inbox/dados";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = await staffDaInbox();
  if (s instanceof NextResponse) return s;
  const { conversas, semJanela, estadoPronto } = await carregarCaixa();
  const contato = req.nextUrl.searchParams.get("contato")?.replace(/\D/g, "");
  if (contato) {
    const c = conversas.find((x) => x.contato === contato);
    return c ? NextResponse.json({ conversa: c, semJanela, estadoPronto }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Na lista só vai a última mensagem de cada conversa: o resto chega ao abrir.
  return NextResponse.json({
    conversas: conversas.map((c) => ({ ...c, mensagens: c.mensagens.slice(-1) })),
    semJanela,
    estadoPronto,
  });
}
