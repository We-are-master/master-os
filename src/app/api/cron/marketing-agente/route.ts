import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { agenteLigado, rodarManha, rodarTarde } from "@/lib/marketing/agente";

/**
 * O agente de marketing, duas vezes por dia (vercel.json):
 *
 *   GET /api/cron/marketing-agente                  manhã: lista, clube, abertura do relâmpago
 *   GET /api/cron/marketing-agente?passo=whatsapp   tarde: WhatsApp do relâmpago no ar
 *
 * `?dry-run=1` conta sem mandar. Sem `MARKETING_AGENTE=on` é sempre ensaio.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://app.getfixfy.com/api/cron/marketing-agente?dry-run=1"
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

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!secretsMatch(bearer, process.env.CRON_SECRET?.trim())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const aplicar = agenteLigado() && req.nextUrl.searchParams.get("dry-run") !== "1";
  try {
    if (req.nextUrl.searchParams.get("passo") === "whatsapp") return NextResponse.json(await rodarTarde({ aplicar }));
    return NextResponse.json(await rodarManha({ aplicar }));
  } catch (e) {
    console.error("[marketing-agente]", e);
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}
