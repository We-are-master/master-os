/**
 * Retrabalho que o parceiro original não aceitou em 24h volta para a equipe (Fase 4).
 * Chamado pelo n8n de hora em hora. Auth: x-internal-secret = INTERNAL_SYNC_SECRET.
 * ?dry-run=1 só lista.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { devolverRetrabalhoVencido } from "@/lib/retrabalho";

export const runtime = "nodejs";
export const maxDuration = 60;

function autorizado(dado: string | null): boolean {
  const segredo = process.env.INTERNAL_SYNC_SECRET?.trim();
  if (!segredo || !dado || dado.length !== segredo.length) return false;
  return timingSafeEqual(Buffer.from(dado), Buffer.from(segredo));
}

export async function POST(req: NextRequest) {
  if (!autorizado(req.headers.get("x-internal-secret"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const aplicar = req.nextUrl.searchParams.get("dry-run") !== "1";
  return NextResponse.json({ ok: true, ...(await devolverRetrabalhoVencido(createServiceClient(), { aplicar })) });
}
