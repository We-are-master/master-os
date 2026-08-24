import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { isSupabaseMissingColumnError } from "@/lib/supabase-schema-compat";
import { notifyVisitPartner } from "@/lib/notify-visit-partner-server";
import { detachVisitFromSelfBill, ensureWeeklySelfBillForVisit } from "@/services/self-bills";
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

/** No POST o status é do servidor: visita nasce agendada. Nascer `completed`
 *  deixava a linha pagável na hora e com `completed_at` nulo para sempre. */
const WRITABLE_ON_CREATE = WRITABLE.filter((k) => k !== "status");

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

function pickWritable(body: VisitBody, keys: readonly string[] = WRITABLE): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in body) out[k] = (body as Record<string, unknown>)[k];
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
    supabase.from("jobs").select("id, reference, status, partner_id, partner_name").eq("id", jobId).maybeSingle(),
    supabase.from("job_visits").select("*").eq("job_id", jobId).is("deleted_at", null),
  ]);
  return {
    job: job as Pick<Job, "id" | "reference" | "status" | "partner_id" | "partner_name"> | null,
    visits: (visits ?? []) as JobVisit[],
  };
}

/** GET — visitas do job com o vínculo de pagamento, para conferência e suporte. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorize();
  if ("error" in auth) return auth.error;
  const { supabase } = auth;
  const { id: jobId } = await ctx.params;
  const { data, error } = await supabase
    .from("job_visits")
    .select("id, visit_index, partner_id, partner_name, status, completed_at, partner_cost, client_price, self_bill_id, scheduled_date")
    .eq("job_id", jobId)
    .is("deleted_at", null)
    .order("visit_index", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  /** O documento de cada visita junto: sem isto, diagnosticar payout exige ir ao banco. */
  const visits = (data ?? []) as (JobVisit & { self_bill_id?: string | null })[];
  const billIds = [...new Set(visits.map((v) => v.self_bill_id).filter(Boolean))] as string[];
  const bills = billIds.length
    ? ((await supabase
        .from("self_bills")
        .select("id, reference, partner_id, partner_name, week_start, week_end, status, net_payout")
        .in("id", billIds)).data ?? [])
    : [];
  return NextResponse.json({ ok: true, visits, bills });
}

/** POST — nova visita. O índice é do servidor, e o gate roda aqui também. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await authorize();
  if ("error" in auth) return auth.error;
  const { supabase, userId, userName } = auth;

  const { id: jobId } = await ctx.params;
  if (!jobId) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as VisitBody;
  const { job } = await loadJobAndVisits(supabase, jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  /**
   * A visita 1 precisa ter parceiro antes de existir uma segunda.
   *
   * A visita 1 é o próprio job: sem parceiro nela, o job não tem dono, o
   * self-bill dela não existe e o dinheiro da visita 2 fica pendurado num job
   * órfão. Não é sobre ordem de execução — é sobre ter a quem pagar.
   */
  if (!job.partner_id?.trim()) {
    return NextResponse.json(
      { error: "Assign a partner to visit 1 (the job) before adding another visit." },
      { status: 409 },
    );
  }

  // Fora isso não há fila: cada linha é um assignment por si, e a anterior não
  // precisa estar concluída.
  const patch: Record<string, unknown> = { ...pickWritable(body, WRITABLE_ON_CREATE), status: "scheduled" };
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
      // Confirmação de trabalho para o parceiro DESTA visita. Não derruba a
      // criação: visita registrada com email falhando é recuperável, o inverso
      // não — o botão de reenviar existe no card.
      const notified = created.partner_id
        ? await notifyVisitPartner(supabase, jobId, created.id).catch((e) => ({
            ok: false,
            error: e instanceof Error ? e.message : "notify failed",
          }))
        : { ok: false, skipped: "no_partner" as const };

      /**
       * Self-bill do parceiro desta visita nasce junto com ela.
       *
       * Mesmo parceiro num período já aberto cai no documento existente;
       * parceiro diferente ganha o seu. O valor só entra no total quando a
       * visita for marcada como concluída — igual ao job, que também fica em
       * rascunho até virar pagável.
       */
      let selfBillId: string | null = null;
      let payoutError: string | null = null;
      if (created.partner_id) {
        try {
          const { data: fullJob } = await supabase.from("jobs").select("*").eq("id", jobId).maybeSingle();
          if (fullJob) selfBillId = await ensureWeeklySelfBillForVisit(fullJob as Job, created, { client: supabase });
          if (!selfBillId) payoutError = "self-bill not created for this visit";
        } catch (e) {
          const err = e as { message?: string; code?: string; details?: string } | null;
          payoutError = [err?.message, err?.code && `code=${err.code}`, err?.details].filter(Boolean).join(" · ") || String(e);
          console.error("ensureWeeklySelfBillForVisit on create failed", e);
        }
      } else {
        // Visita sem parceiro não gera documento: quem vai receber ainda não existe.
        payoutError = "visit has no partner yet, so no self-bill";
      }
      return NextResponse.json({ ok: true, visit: created, notified, selfBillId, payoutError });
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

  /**
   * Visita fechada entra no self-bill do parceiro DELA.
   *
   * É aqui e não na criação porque o que paga é trabalho feito, e a data de
   * conclusão é o que decide o período. Parceiro diferente da visita 1 ganha
   * documento próprio; mesmo parceiro no mesmo período cai no mesmo.
   */
  /**
   * Qualquer mexida que muda o dinheiro ou o dono dele acerta o documento.
   *
   * Não basta reagir a "virou completed": reabrir uma visita, trocar o
   * parceiro ou mover a data deixavam o valor pendurado no documento antigo.
   * O detach solta do documento em que ela estava (recalculando ou cancelando
   * se ficou vazio) e o ensure a coloca no documento certo.
   */
  const touchedPayout =
    "status" in patch || "partner_id" in patch || "scheduled_date" in patch || "partner_cost" in patch || "materials_cost" in patch;
  let selfBillId: string | null = null;
  /** O erro volta na resposta: pagamento que falha em silêncio é dinheiro sem documento. */
  let payoutError: string | null = null;
  if (touchedPayout) {
    try {
      const solta = await detachVisitFromSelfBill(updated.id, supabase);
      /**
       * Documento já pago não solta a visita, e por isso ela também não pode
       * ser religada: o `ensure` criaria um documento novo com o valor CHEIO
       * e o parceiro receberia duas vezes pelo mesmo trabalho.
       */
      if (!solta.detached) {
        payoutError =
          "this visit is on a self-bill that was already paid; the change was saved but the payout was not moved. Settle the difference as a manual adjustment.";
      } else if (updated.partner_id && updated.status !== "cancelled") {
        const { data: fullJob } = await supabase.from("jobs").select("*").eq("id", jobId).maybeSingle();
        if (!fullJob) {
          payoutError = "job not found when linking the self-bill";
        } else {
          selfBillId = await ensureWeeklySelfBillForVisit(fullJob as Job, updated, { client: supabase });
          if (!selfBillId) payoutError = "ensureWeeklySelfBillForVisit returned null";
        }
      }
    } catch (e) {
      // Erro do PostgREST não é `Error`: sem isto a resposta dizia
      // "[object Object]" e escondia justamente a causa.
      const err = e as { message?: string; code?: string; details?: string; hint?: string } | null;
      payoutError = [err?.message, err?.code && `code=${err.code}`, err?.details, err?.hint]
        .filter(Boolean)
        .join(" · ") || String(e);
      console.error("visit payout sync failed", e);
    }
  }

  await auditVisit({
    supabase, job,
    action: patch.status === "completed" ? "completed" : "updated",
    visit: updated, userId, userName,
    extra: { fields: Object.keys(patch) },
  });
  return NextResponse.json({ ok: true, visit: updated, selfBillId, payoutError });
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
  /**
   * Excluir sem soltar do documento deixava o parceiro recebendo por trabalho
   * que não existe mais: o `net_payout` continuava com o valor, aprovável e
   * pagável.
   */
  try {
    await detachVisitFromSelfBill(removed.id, supabase, { cancelIfEmpty: true });
  } catch (e) {
    console.error("detachVisitFromSelfBill on delete failed", e);
  }
  await auditVisit({ supabase, job, action: "deleted", visit: removed, userId, userName });
  return NextResponse.json({ ok: true });
}
