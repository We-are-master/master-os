/** O n8n chama de 10 em 10 minutos: Stop e respostas de WhatsApp que caíram no Zendesk. */
import { NextRequest, NextResponse } from "next/server";
import { chaveDoN8nOk } from "@/lib/marketing/chave-do-n8n";
import { varrerRespostasDoZendesk } from "@/lib/marketing/zendesk-respostas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!chaveDoN8nOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ensaio = req.nextUrl.searchParams.get("dry-run") === "1";
  try {
    return NextResponse.json(await varrerRespostasDoZendesk({ aplicar: !ensaio, minutos: Number(req.nextUrl.searchParams.get("minutos") ?? "30") }));
  } catch (err) {
    console.error("[campanha] varredura do Zendesk falhou:", err);
    return NextResponse.json({ ok: false, reason: err instanceof Error ? err.message : "falhou" }, { status: 500 });
  }
}
