/**
 * O disparo de WhatsApp de marketing, de hora em hora.
 *
 * Esta rota EXECUTA. Chamar para "ver se está de pé" manda mensagem de
 * verdade (ver /api/cron/marketing-lifecycle). Para olhar sem mexer:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        "https://app.getfixfy.com/api/cron/marketing-whatsapp?dry-run=1"
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { dispararWhatsApp, whatsappMarketingLigado } from "@/lib/marketing/whatsapp";

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

  const ensaio = req.nextUrl.searchParams.get("dry-run") === "1";
  if (!whatsappMarketingLigado() && !ensaio) {
    return NextResponse.json({ ok: true, desligado: "MARKETING_WHATSAPP != on" });
  }

  try {
    const r = await dispararWhatsApp({ aplicar: !ensaio });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    console.error("[marketing-whatsapp] volta falhou:", err);
    return NextResponse.json({ ok: false, reason: err instanceof Error ? err.message : "falhou" }, { status: 500 });
  }
}
