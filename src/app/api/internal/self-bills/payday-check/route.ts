/**
 * Conferência antes do payday (Fase 1, dono 09/10/2026). Só lê; devolve o que está fora
 * do lugar para a equipe acertar antes de pagar:
 *  1. mais de um documento aberto do mesmo parceiro na mesma quinzena
 *  2. job num documento de outro parceiro
 *  3. job ainda em final check num documento já em pagamento ou pago
 *  4. documento aberto de £0 de quinzena que já fechou
 * Auth: x-internal-secret = INTERNAL_SYNC_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { conferirPayday } from "@/lib/payday-check";

export const runtime = "nodejs";

function autorizado(dado: string | null): boolean {
  const segredo = process.env.INTERNAL_SYNC_SECRET?.trim();
  if (!segredo || !dado || dado.length !== segredo.length) return false;
  return timingSafeEqual(Buffer.from(dado), Buffer.from(segredo));
}

export async function GET(req: NextRequest) {
  if (!autorizado(req.headers.get("x-internal-secret"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await conferirPayday(createServiceClient()));
}
