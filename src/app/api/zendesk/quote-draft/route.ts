/**
 * O gatilho do quoter do Zendesk — fase 1, supervisão total.
 *
 * POST { ticket_id, post?: boolean } → lê o ticket INTEIRO (thread + fotos,
 * com visão), consolida o pedido, cota pelo MESMO núcleo do price-check e —
 * só se `post: true` — grava o rascunho como NOTA INTERNA no ticket. Sem
 * `post`, devolve a nota no response para conferência sem tocar no Zendesk.
 *
 * Não existe resposta pública neste código, de propósito: as primeiras 10
 * quotes o Victor revisa e envia manualmente; o envio direto só nasce noutra
 * fase, com ordem explícita dele (regra de 17/08/2026 — B2B não pode errar).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { cotarTicket } from "@/lib/zendesk-quoter/quoter";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function autorizado(req: NextRequest): Promise<boolean> {
  const key = req.headers.get("x-api-key")?.trim();
  const esperada = process.env.MASTER_OS_JOB_WEBHOOK_API_KEY?.trim();
  if (esperada && key === esperada) return true;
  const auth = await requireAuth();
  return !(auth instanceof NextResponse);
}

export async function POST(req: NextRequest) {
  if (!(await autorizado(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let ticketId = 0;
  let post = false;
  try {
    const body = (await req.json()) as { ticket_id?: number | string; post?: boolean };
    ticketId = Number(body.ticket_id);
    post = body.post === true;
  } catch {
    /* cai no 422 abaixo */
  }
  if (!Number.isFinite(ticketId) || ticketId <= 0) {
    return NextResponse.json({ error: "send { ticket_id: 12345, post?: true }" }, { status: 422 });
  }

  try {
    const r = await cotarTicket(ticketId, post);
    return NextResponse.json({
      ticket_id: r.ticketId,
      posted_as_internal_note: post,
      note: r.nota,
      quote_request: r.pedido.quoteRequest,
      missing_info: r.pedido.missingInfo,
      total: r.resultado.quote.total,
      gaps: r.resultado.quote.gaps,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
