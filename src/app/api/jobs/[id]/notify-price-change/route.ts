import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { avisarMudancaDePreco, type MudancaDePreco } from "@/lib/notify-price-change-server";

/**
 * POST /api/jobs/[id]/notify-price-change
 *
 * Avisa cliente e parceiro que o preço do job mudou, cada um só com o seu
 * valor (antigo riscado ao lado do novo). A rota é só a porta: a decisão
 * inteira vive em `avisarMudancaDePreco`.
 *
 * Body:
 * {
 *   antes:  { client: number | null, partner: number | null },
 *   depois: { client: number | null, partner: number | null },
 *   billing: "fixed" | "hourly",
 *   taxas?: { antes?: { client?, partner? }, depois?: { client?, partner? }, horas? }
 * }
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

const numOuNull = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: jobId } = await ctx.params;
  if (!jobId) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = (await req.json().catch(() => null)) as Partial<Record<string, unknown>> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 });
  }
  const lado = (v: unknown) => {
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    return { client: numOuNull(o.client), partner: numOuNull(o.partner) };
  };
  const billing = body.billing === "hourly" ? "hourly" : body.billing === "fixed" ? "fixed" : null;
  if (!billing) return NextResponse.json({ error: "billing must be 'fixed' or 'hourly'" }, { status: 400 });

  const t = (body.taxas && typeof body.taxas === "object" ? body.taxas : null) as Record<string, unknown> | null;
  const mudanca: MudancaDePreco = {
    antes: lado(body.antes),
    depois: lado(body.depois),
    billing,
    taxas: t ? { antes: lado(t.antes), depois: lado(t.depois), horas: numOuNull(t.horas) } : null,
  };

  const r = await avisarMudancaDePreco(jobId, mudanca);
  const naoAchou = !r.client.ok && "error" in r.client && r.client.error === "job_not_found";
  return NextResponse.json({ ok: !naoAchou, ...r }, { status: naoAchou ? 404 : 200 });
}
