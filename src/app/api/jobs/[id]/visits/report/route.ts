import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildVisitReportUrl } from "@/lib/partner-job-report-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

async function autorizar() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return { error: auth };
  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", auth.user.id)
    .maybeSingle();
  const perfil = profile as { role?: string; full_name?: string } | null;
  if (!ALLOWED_ROLES.has(perfil?.role ?? "")) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { userId: auth.user.id, userName: perfil?.full_name ?? null };
}

async function carregarVisita(jobId: string, visitId: string) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("job_visits")
    .select("id, job_id, visit_index, partner_id")
    .eq("id", visitId)
    .eq("job_id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  return { supabase, visita: data as { id: string; job_id: string; visit_index: number; partner_id: string | null } | null };
}

/**
 * Relatório de UMA visita extra (19/10/2026).
 * GET ?visitId= → o link do formulário para o parceiro da visita (copiar e mandar).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await autorizar();
  if ("error" in a) return a.error;
  const { id: jobId } = await ctx.params;
  const visitId = new URL(req.url).searchParams.get("visitId")?.trim() ?? "";
  const { visita } = await carregarVisita(jobId, visitId);
  if (!visita) return NextResponse.json({ error: "Visit not found" }, { status: 404 });
  if (!visita.partner_id) return NextResponse.json({ error: "Assign a partner to this visit first." }, { status: 409 });
  const url = await buildVisitReportUrl(visita.id, visita.partner_id);
  return NextResponse.json({ ok: true, url });
}

/** POST { visitId, approve } → aprova (ou desfaz) o relatório da visita. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await autorizar();
  if ("error" in a) return a.error;
  const { id: jobId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { visitId?: string; approve?: boolean };
  const { supabase, visita } = await carregarVisita(jobId, String(body.visitId ?? ""));
  if (!visita) return NextResponse.json({ error: "Visit not found" }, { status: 404 });
  const aprovar = body.approve !== false;
  const { data, error } = await supabase
    .from("job_visits")
    .update({
      report_approved_at: aprovar ? new Date().toISOString() : null,
      report_approved_by: aprovar ? a.userId : null,
    })
    .eq("id", visita.id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, visit: data });
}
