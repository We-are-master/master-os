/**
 * Ações do time na aba Leads: mudar o estado e anotar.
 *
 *   PATCH { status: "contacted" | "lost" | "new" | "hot" | "unsubscribed", reason? }
 *   PATCH { note: "texto" }
 *
 * Usa a sessão de quem está logado: a política da 294 só deixa staff interno.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient } from "@/lib/supabase/server";
import { anotar, mudarEstado, type EstadoDoLead } from "@/lib/site-leads/core";

export const dynamic = "force-dynamic";

const PERMITIDOS: EstadoDoLead[] = ["new", "hot", "contacted", "lost", "unsubscribed"];

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  let body: { status?: string; reason?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sb = await createClient();
  if (typeof body.note === "string") {
    const r = await anotar(sb, id, body.note, auth.user.id);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (body.status && PERMITIDOS.includes(body.status as EstadoDoLead)) {
    const r = await mudarEstado(sb, id, body.status as EstadoDoLead, { motivo: body.reason ?? null, actorId: auth.user.id });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  return NextResponse.json({ error: "Envie status válido ou note." }, { status: 400 });
}
