/**
 * A volta do motor da reserva abandonada. O n8n chama a cada 10 minutos.
 *
 * Esta rota EXECUTA quando RESERVA_ABANDONADA=on: chamar "para ver se está de
 * pé" manda e-mail de verdade. Para olhar sem mexer:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        "https://app.getfixfy.com/api/cron/reserva-abandonada?dry-run=1"
 *
 * Com o interruptor desligado ela sempre responde em ensaio.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { motorLigado, rodarMotor } from "@/lib/site-leads/motor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

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
  const dryRun = req.nextUrl.searchParams.get("dry-run") === "1";
  const resultado = await rodarMotor({ dryRun });
  return NextResponse.json({ ligado: motorLigado(), ...resultado });
}
