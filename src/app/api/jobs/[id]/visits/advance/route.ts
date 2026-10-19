import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { avancarVisitas } from "@/lib/job-visit-advance-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * POST — depois de um "Done" numa visita, leva o job para o próximo passo
 * (dono, 19/10/2026).
 *
 * Body: `{ primary: true }` quando o Done foi na visita 1 (o próprio job).
 *  - ainda tem visita marcada → o job fica Scheduled com a data da próxima, e a
 *    visita 1 guarda em `jobs.primary_visit_done` a data em que foi feita;
 *  - era a última → `{ kind: "finish" }`: a tela leva para Final review pelo
 *    caminho de sempre (`handleStatusChange`, com as regras do `canAdvanceJob`).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", auth.user.id)
    .maybeSingle();
  const perfil = profile as { role?: string; full_name?: string } | null;
  if (!ALLOWED_ROLES.has(perfil?.role ?? "")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: jobId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { primary?: boolean };
  const r = await avancarVisitas(createServiceClient(), jobId, {
    primary: Boolean(body.primary),
    userId: auth.user.id,
    userName: perfil?.full_name ?? null,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
