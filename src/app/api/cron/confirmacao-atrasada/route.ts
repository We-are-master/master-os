import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { recuperarConfirmacoes } from "@/lib/client-confirmation/catch-up";

/**
 * Rede de segurança da confirmação de agendamento, uma vez por dia (vercel.json,
 * 12:00 UTC = 12h/13h de Londres). Pega job de amanhã em diante, com parceiro,
 * que não confirmou nada ao cliente: atribuição por um caminho que não chama a
 * confirmação, ou envio que falhou. O lembrete de véspera (18h-22h) pula quem
 * recebeu a confirmação nas últimas 24h, então continua uma mensagem por noite.
 *
 *   GET /api/cron/confirmacao-atrasada             manda, se CONFIRMACAO_ATRASADA=on
 *   GET /api/cron/confirmacao-atrasada?dry-run=1   só lista
 *
 * Sem `CONFIRMACAO_ATRASADA=on` é sempre ensaio (não grava nada). Mandar também
 * exige `CLIENT_MESSAGING_ENABLED=1`. Script equivalente: scripts/confirmacao-atrasada.mts.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function recuperacaoLigada(): boolean {
  return process.env.CONFIRMACAO_ATRASADA?.trim() === "on";
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!secretsMatch(bearer, process.env.CRON_SECRET?.trim())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const aplicar = recuperacaoLigada() && req.nextUrl.searchParams.get("dry-run") !== "1";
  try {
    const r = await recuperarConfirmacoes(createServiceClient(), { aplicar });
    const conta = (x: string) => r.linhas.filter((l) => l.resultado === x).length;
    console.log(`[confirmacao-atrasada] ${r.modo}: ${conta("enviado")} enviado(s), ${conta("enviaria")} enviaria(m), ${conta("pulado")} pulado(s), ${conta("falhou")} falha(s)`);
    return NextResponse.json({ ...r, ligado: recuperacaoLigada() });
  } catch (e) {
    console.error("[confirmacao-atrasada]", e);
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
