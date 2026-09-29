/**
 * Chase do Harvey no WhatsApp (src/lib/harvey-wa/chase.ts), a cada 10 min pelo n8n.
 *
 * Esta rota EXECUTA: manda mensagem no WhatsApp de cliente. Para olhar sem mexer:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        "https://app.getfixfy.com/api/cron/harvey-wa?dry-run=1"
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { varrerChases } from "@/lib/harvey-wa/chase";

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
  if (process.env.HARVEY_WA_LIGADO !== "1" && !ensaio) return NextResponse.json({ ok: true, desligado: "HARVEY_WA_LIGADO != 1" });
  try {
    const r = await varrerChases(createServiceClient(), { aplicar: !ensaio });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    console.error("[harvey-wa chase] falhou:", err);
    return NextResponse.json({ ok: false, reason: err instanceof Error ? err.message : "falhou" }, { status: 500 });
  }
}
