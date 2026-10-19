import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { jobStatusRank } from "@/lib/job-phases";
import { proximoPassoDasVisitas, type VisitaParaAvancar } from "@/lib/job-visit-advance";
import type { Job, PrimaryVisitDone } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);
/** Estágios em que o job ainda está "em campo": só esses voltam para Scheduled. */
const EM_CAMPO = new Set(["scheduled", "late", "in_progress"]);

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
  const supabase = createServiceClient();

  const [{ data: jobRow }, { data: visitRows }] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", jobId).maybeSingle(),
    supabase.from("job_visits").select("*").eq("job_id", jobId).is("deleted_at", null),
  ]);
  const job = jobRow as Job | null;
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const visits = (visitRows ?? []) as VisitaParaAvancar[];

  const jaFeita = job.primary_visit_done ?? null;
  const primaryDone = Boolean(body.primary) || Boolean(jaFeita) || jobStatusRank(job.status) >= 40;
  const passo = proximoPassoDasVisitas({ primaryDone, visits });

  if (passo.kind !== "next_visit") return NextResponse.json({ ok: true, ...passo });

  const proxima = passo.visit;
  const patch: Record<string, unknown> = {
    scheduled_date: proxima.scheduled_date ?? null,
    scheduled_start_at: proxima.scheduled_start_at ?? null,
    scheduled_end_at: proxima.scheduled_end_at ?? null,
    expected_finish_at: proxima.scheduled_end_at ?? null,
  };
  if (EM_CAMPO.has(String(job.status))) patch.status = "scheduled";
  if (!jaFeita) {
    const v1: PrimaryVisitDone = {
      scheduled_date: job.scheduled_date ?? null,
      scheduled_start_at: job.scheduled_start_at ?? null,
      scheduled_end_at: job.scheduled_end_at ?? null,
      done_at: new Date().toISOString(),
    };
    patch.primary_visit_done = v1;
  }

  const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  try {
    await supabase.from("audit_logs").insert({
      entity_type: "job",
      entity_id: job.id,
      entity_ref: job.reference,
      action: "visit_advanced",
      field_name: `visit_${proxima.visit_index}`,
      user_id: auth.user.id,
      user_name: perfil?.full_name ?? null,
      metadata: { next_visit_id: proxima.id, next_visit_index: proxima.visit_index, scheduled_date: proxima.scheduled_date ?? null },
    });
  } catch {
    console.error("visit advance audit failed");
  }

  return NextResponse.json({ ok: true, kind: "next_visit", visit: proxima });
}
