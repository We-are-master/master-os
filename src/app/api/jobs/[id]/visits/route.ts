import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { canAddAnotherVisit } from "@/lib/job-visit-rollup";
import { jobStatusRank } from "@/lib/job-phases";
import { isSupabaseMissingColumnError } from "@/lib/supabase-schema-compat";
import type { Job, JobVisit } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/** O tipo do client de serviço tem que sair de uma chamada real: o genérico
 *  padrão de `createClient` não bate com o que a chamada infere. */
function serviceClient(url: string, key: string) {
  return createClient(url, key);
}
type ServiceClient = ReturnType<typeof serviceClient>;

/** Colunas que o cliente pode mandar. Índice, carimbos e autoria são do servidor. */
const WRITABLE = [
  "catalog_service_id", "partner_id", "partner_name",
  "scheduled_date", "scheduled_start_at", "scheduled_end_at", "expected_finish_at",
  "client_price", "partner_cost", "materials_cost",
  "status", "scope", "notes",
] as const;

type VisitBody = Partial<Record<(typeof WRITABLE)[number], unknown>> & { visitId?: string };

/**
 * Visitas de um job.
 *
 * Existe porque até aqui todo CRUD de `job_visits` ia do browser direto ao
 * Supabase: sem validação de servidor, sem audit e sem o gate — e a UI não é a
 * única porta da tabela. O gate em especial não pode viver só no botão: quem
 * chama a API fora da tela contorna a regra inteira.
 */
async function authorize() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return { error: auth };

  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", auth.user.id)
    .maybeSingle();
  const row = profile as { role?: string; full_name?: string } | null;
  if (!ALLOWED_ROLES.has(row?.role ?? "")) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { error: NextResponse.json({ error: "Server not configured" }, { status: 503 }) };
  }
  return {
    supabase: serviceClient(url, key),
    userId: auth.user.id,
    userName: row?.full_name ?? null,
  };
}

function pickWritable(body: VisitBody): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of WRITABLE) if (k in body) out[k] = body[k];
  return out;
}

type AuditInput = {
  supabase: ServiceClient;
  job: Pick<Job, "id" | "reference">;
  action: string;
  visit: Pick<JobVisit, "id" | "visit_index" | "partner_name">;
  userId: string;
  userName: string | null;
  extra?: Record<string, unknown>;
};

/** Audit no job, que é onde a Command history do card lê. Nunca derruba a request. */
async function auditVisit(input: AuditInput) {
  try {
    await input.supabase.from("audit_logs").insert({
      entity_type: "job",
      entity_id: input.job.id,
      entity_ref: input.job.reference,
      action: input.action,
      field_name: `visit_${input.visit.visit_index}`,
      user_id: input.userId,
      user_name: input.userName,
      metadata: {
        visit_id: input.visit.id,
        visit_index: input.visit.visit_index,
        partner_name: input.visit.partner_name ?? null,
        ...(input.extra ?? {}),
      },
    });
  } catch {
    console.error("Failed to write visit audit log");
  }
}

async function loadJobAndVisits(supabase: ServiceClient, jobId: string) {
  const [{ data: job }, { data: visits }] = await Promise.all([
    supabase.from("jobs").select("id, reference, status").eq("id", jobId).maybeSingle(),
    supabase.from("job_visits").select("*").eq("job_id", jobId).is("deleted_at", null),
  ]);
  return {
    job: job as Pick<Job, "id" | "reference" | "status"> | null,
    visits: (visits ?? []) as JobVisit[],
  };
}

/** POST — nova visita. O índice é do servidor, e o gate roda aqui também. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorize();
  if ("error" in auth) return auth.error;
  const { supabase, userId, userName } = auth;

  const { id: jobId } = await ctx.params;
  if (!jobId) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as VisitBody;
  const { job, visits } = await loadJobAndVisits(supabase, jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const gate = canAddAnotherVisit(job, visits, jobStatusRank);
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.reason }, { status: 409 });
  }

  const patch = pickWritable(body);
  if (!patch.scheduled_date) {
    return NextResponse.json({ error: "scheduled_date required" }, { status: 400 });
  }

  // O índice sai do maior vivo + 1 (visita 1 é o job). A corrida real é barrada
  // pelo índice único parcial da mig 161; uma retentativa cobre o empate.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: top } = await supabase
      .from("job_visits")
      .select("visit_index")
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .order("visit_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextIndex = ((top as { visit_index?: number } | null)?.visit_index ?? 1) + 1 + attempt;

    const { data, error } = await supabase
      .from("job_visits")
      .insert({ ...patch, job_id: jobId, visit_index: nextIndex, created_by: userId, updated_by: userId })
      .select()
      .single();

    if (!error) {
      const created = data as JobVisit;
      await auditVisit({
        supabase, job, action: "created", visit: created, userId, userName,
        extra: { client_price: created.client_price, partner_cost: created.partner_cost },
      });
      return NextResponse.json({ ok: true, visit: created });
    }
    if (error.code !== "23505") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }
  return NextResponse.json({ error: "Could not allocate a visit number, try again" }, { status: 409 });
}

/** PATCH — edita ou fecha uma visita. Fechar carimba `completed_at`. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorize();
  if ("error" in auth) return auth.error;
  const { supabase, userId, userName } = auth;

  const { id: jobId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as VisitBody;
  const visitId = body.visitId?.trim();
  if (!jobId || !visitId) return NextResponse.json({ error: "visitId required" }, { status: 400 });

  const { job } = await loadJobAndVisits(supabase, jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const patch = pickWritable(body);
  if (patch.status === "completed") {
    patch.completed_at = new Date().toISOString();
  } else if (typeof patch.status === "string") {
    // Reabrir tem que soltar o carimbo, senão o payout mira um período morto.
    patch.completed_at = null;
  }
  patch.updated_by = userId;

  const applyPatch = async (body: Record<string, unknown>) =>
    supabase
      .from("job_visits")
      .update(body)
      .eq("id", visitId)
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .select()
      .single();

  let { data, error } = await applyPatch(patch);
  if (error && isSupabaseMissingColumnError(error, "completed_at")) {
    // Ambiente sem a mig 275: fecha a visita do mesmo jeito, sem o carimbo. O
    // gate lê `status`, então continua funcionando; quem perde é o payout, que
    // fica sem âncora de período até a migração rodar.
    const { completed_at: _drop, ...withoutStamp } = patch;
    void _drop;
    ({ data, error } = await applyPatch(withoutStamp));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const updated = data as JobVisit;
  await auditVisit({
    supabase, job,
    action: patch.status === "completed" ? "completed" : "updated",
    visit: updated, userId, userName,
    extra: { fields: Object.keys(patch) },
  });
  return NextResponse.json({ ok: true, visit: updated });
}

/** DELETE — soft delete, para o rollup e o payout pararem de contar a visita. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorize();
  if ("error" in auth) return auth.error;
  const { supabase, userId, userName } = auth;

  const { id: jobId } = await ctx.params;
  const visitId = new URL(req.url).searchParams.get("visitId")?.trim();
  if (!jobId || !visitId) return NextResponse.json({ error: "visitId required" }, { status: 400 });

  const { job } = await loadJobAndVisits(supabase, jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("job_visits")
    .update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq("id", visitId)
    .eq("job_id", jobId)
    .is("deleted_at", null)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const removed = data as JobVisit;
  await auditVisit({ supabase, job, action: "deleted", visit: removed, userId, userName });
  return NextResponse.json({ ok: true });
}
