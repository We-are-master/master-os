/**
 * A varredura do funil, de hora em hora.
 *
 * Olha a base e põe cada contato na sequência certa: quem não comprou no
 * aperto dos 30 dias (ou no fogo baixo, se for lead velho), quem comprou no
 * clube, que começa duas semanas depois do job. Quem comprou desde a última
 * volta sai do nurture aqui.
 *
 * Esta rota EXECUTA. Chamar para "ver se está de pé" inscreve gente de verdade,
 * e já custou caro uma vez neste código (20/08/2026, dois testes soltaram um
 * parceiro de quinze jobs). Para olhar sem mexer:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        "https://app.getfixfy.com/api/cron/marketing-lifecycle?dry-run=1"
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { varrerFunil, funilLigado } from "@/lib/marketing/lifecycle";

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

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!secretsMatch(bearer, process.env.CRON_SECRET?.trim())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /** `?dry-run=1` calcula tudo e não manda nada. É como se testa esta rota. */
  const ensaio = req.nextUrl.searchParams.get("dry-run") === "1";

  // Trava 4: o interruptor. Desligado, só o ensaio passa.
  if (!funilLigado() && !ensaio) {
    return NextResponse.json({ ok: true, desligado: "MARKETING_LIFECYCLE != on" });
  }

  try {
    const r = await varrerFunil({ aplicar: !ensaio });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    console.error("[marketing-lifecycle] varredura falhou:", err);
    return NextResponse.json({ ok: false, reason: err instanceof Error ? err.message : "falhou" }, { status: 500 });
  }
}
