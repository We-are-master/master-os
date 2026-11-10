import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { avisarMudancaDeDados } from "@/lib/notify-job-details-server";
import type { CampoDoJob, MudancaDeCampo } from "@/lib/emails/job-details-changed";

/**
 * POST /api/jobs/[id]/notify-job-details
 * Body: { mudancas: [{ campo: "address" | "client", antes, depois }] }
 * A decisão de quem recebe vive em `avisarMudancaDeDados`.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);
const CAMPOS = new Set<CampoDoJob>(["address", "client"]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!ALLOWED_ROLES.has(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: jobId } = await ctx.params;
  if (!jobId) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as { mudancas?: unknown } | null;
  const txt = (v: unknown) => (typeof v === "string" ? v : null);
  const mudancas: MudancaDeCampo[] = (Array.isArray(body?.mudancas) ? body.mudancas : [])
    .map((m) => (m && typeof m === "object" ? (m as Record<string, unknown>) : {}))
    .filter((m) => CAMPOS.has(m.campo as CampoDoJob))
    .map((m) => ({ campo: m.campo as CampoDoJob, antes: txt(m.antes), depois: txt(m.depois) }));
  if (!mudancas.length) return NextResponse.json({ error: "mudancas required" }, { status: 400 });

  const r = await avisarMudancaDeDados(jobId, mudancas);
  const naoAchou = !r.client.ok && "error" in r.client && r.client.error === "job_not_found";
  return NextResponse.json({ ok: !naoAchou, ...r }, { status: naoAchou ? 404 : 200 });
}
