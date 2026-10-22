import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { varrerReclamacoes } from "@/lib/reclamacao/aviso";

/**
 * Aviso de reclamação ao cliente (dono, 22/10/2026): job que entra em On Hold como
 * reclamação manda UM e-mail curto pelo ticket do job (`src/lib/reclamacao/aviso.ts`).
 *
 *   GET /api/cron/reclamacao              manda (CLIENT_MESSAGING_ENABLED=1)
 *   GET /api/cron/reclamacao?dry-run=1    só diz o que faria
 *
 * Auth: `Authorization: Bearer CRON_SECRET` (Vercel) ou `x-internal-secret: INTERNAL_SYNC_SECRET`.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function segredoConfere(dado: string | null | undefined, esperado: string | null | undefined): boolean {
  if (!dado || !esperado) return false;
  const a = Buffer.from(dado);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const ok =
    segredoConfere(bearer, process.env.CRON_SECRET?.trim()) ||
    segredoConfere(req.headers.get("x-internal-secret"), process.env.INTERNAL_SYNC_SECRET?.trim());
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ensaio = req.nextUrl.searchParams.get("dry-run") === "1";
  const r = await varrerReclamacoes(createServiceClient(), { aplicar: !ensaio });
  return NextResponse.json({ ok: true, ...r });
}
