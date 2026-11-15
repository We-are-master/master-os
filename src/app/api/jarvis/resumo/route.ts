/**
 * Resumo do dia para o JARVIS (assistente local do dono, por voz).
 *
 * GET só leitura, com chave própria em `x-api-key` = `JARVIS_READ_API_KEY`.
 * A chave é separada das de escrita (jobs, quotes) de propósito: quem tem esta
 * só consegue ler este resumo. Sem a variável configurada, a rota fica fechada.
 *
 * As contas moram em `@/lib/jarvis-resumo`. O bloco `home` traz os números da home do OS
 * (mês de Londres, em GBP), montados pelas mesmas funções da tela (`@/lib/jarvis-home`).
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { montarResumoJarvis } from "@/lib/jarvis-resumo";

export const dynamic = "force-dynamic";
/** O bloco `home` roda as mesmas buscas da home do OS (o /api/pulse/ceo também pede 60s). */
export const maxDuration = 60;

function autorizado(req: NextRequest): boolean {
  const esperada = process.env.JARVIS_READ_API_KEY?.trim();
  const recebida = req.headers.get("x-api-key")?.trim();
  if (!esperada || !recebida) return false;
  const a = Buffer.from(recebida);
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const dia = req.nextUrl.searchParams.get("dia") ?? undefined;
    if (dia && !/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
      return NextResponse.json({ error: "dia deve ser YYYY-MM-DD" }, { status: 400 });
    }
    const resumo = await montarResumoJarvis(createServiceClient(), new Date(), dia);
    return NextResponse.json(resumo, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[jarvis/resumo]", err);
    return NextResponse.json({ error: "Falha ao montar o resumo" }, { status: 500 });
  }
}
