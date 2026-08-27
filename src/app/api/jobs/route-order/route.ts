import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/jobs/route-order  { orderedJobIds: string[] }
 *
 * Grava a ordem do dia decidida no drag do painel de rota (Live View):
 * route_seq = posição 1-based. Essa decisão vira a verdade para o painel,
 * a numeração do mapa e o email das 17h do parceiro — que deixa de otimizar
 * a rota quando um humano já disse a ordem (mig 282).
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let body: { orderedJobIds?: unknown };
  try {
    body = (await req.json()) as { orderedJobIds?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const ids = Array.isArray(body.orderedJobIds) ? body.orderedJobIds.filter((x): x is string => typeof x === "string") : [];
  if (ids.length === 0 || ids.length > 50 || ids.some((id) => !isValidUUID(id))) {
    return NextResponse.json({ error: "orderedJobIds must be 1–50 job UUIDs" }, { status: 400 });
  }

  const supabase = createServiceClient();
  for (const [i, id] of ids.entries()) {
    const { error } = await supabase.from("jobs").update({ route_seq: i + 1 }).eq("id", id);
    if (error) {
      // Coluna ainda não existe = migração 282 não aplicada. Aviso, não 500.
      const faltaColuna = /route_seq/.test(error.message ?? "");
      return NextResponse.json(
        { error: faltaColuna ? "route_seq column missing — apply migration 282" : error.message },
        { status: faltaColuna ? 409 : 500 },
      );
    }
  }
  return NextResponse.json({ ok: true, updated: ids.length });
}
