/**
 * "Attach job or quote" do composer da /inbox (regras em `@/lib/inbox/anexo`).
 * Tudo por POST: a busca leva nome e endereço digitados, que não vão em URL.
 */

import { NextRequest, NextResponse } from "next/server";
import { staffDaInbox } from "@/lib/inbox/staff";
import { buscarParaAnexar, textoDaQuote, textoDoJob, type ValorDoAnexo } from "@/lib/inbox/anexo";

export const dynamic = "force-dynamic";

const limpo = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(req: NextRequest) {
  const s = await staffDaInbox();
  if (s instanceof NextResponse) return s;
  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (corpo.acao === "buscar") {
    return NextResponse.json({ itens: await buscarParaAnexar(s.sb, corpo) });
  }

  const id = limpo(corpo.id);
  const valor: ValorDoAnexo = corpo.valor === "parceiro" || corpo.valor === "nenhum" ? corpo.valor : "cliente";
  if (!id || (corpo.tipo !== "job" && corpo.tipo !== "quote")) return NextResponse.json({ error: "tipo and id are required" }, { status: 400 });
  const texto = corpo.tipo === "job" ? await textoDoJob(s.sb, id, valor, limpo(corpo.parceiroId)) : await textoDaQuote(s.sb, id, valor);
  if (!texto) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ texto });
}
