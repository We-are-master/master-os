import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import {
  notifyPartnerJobZendesk,
  type NotifyKind,
} from "@/lib/notify-partner-job-zendesk-server";
import { dispatchJobCreatedZendesk } from "@/lib/zendesk-lifecycle";
import { enviarConfirmacaoDoCliente } from "@/lib/client-confirmation/send";

export const dynamic = "force-dynamic";
export const runtime  = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

interface NotifyBody {
  kind?: NotifyKind;          // default "assigned" for backwards compatibility
  reason?: string | null;     // e.g. cancellation reason / hold reason
  newStatusLabel?: string;    // human label e.g. "Cancelled", "On Hold"
  /** When kind = "rescheduled", these supply the side-by-side date comparison. */
  oldDateLine?: string;
  oldTimeLine?: string | null;
  newDateLine?: string;
  newTimeLine?: string | null;
  /** When true, skip the Expo push send — caller already triggered it via notifyAssignedPartnerAboutJob. */
  skipPush?: boolean;
}

/**
 * POST /api/jobs/[id]/notify-partner-zendesk
 *
 * Sends a push notification to the assigned partner AND opens / replies on
 * a Zendesk Side Conversation. Returns the status of both so the UI can
 * surface them together.
 *
 * Behaviour:
 *   - First call for a job → creates a new side conversation, stores its id
 *     on jobs.zendesk_side_conversation_id
 *   - Subsequent calls → reply on the existing booked thread
 *   - on_hold / cancelled → new side conversation (distinct subject in sidebar)
 *   - For cancelled / on_hold the email body includes the reason
 *
 * No-ops (returns ok:true with `skipped`) when:
 *   - job.external_source != 'zendesk' or no external_ref
 *   - job has no partner_id
 *   - partner has no email AND no push token (nothing to send)
 *
 * Always logs the attempt to job_zendesk_events.
 *
 * The notification engine itself lives in
 * `@/lib/notify-partner-job-zendesk-server` so it can be reused by internal
 * / automation callers (e.g. the Zendesk on-hold macro webhook).
 */
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

  let body: NotifyBody = {};
  try { body = (await req.json()) as NotifyBody; } catch { /* empty body OK */ }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "Server not configured" }, { status: 503 });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  const { status, body: payload } = await notifyPartnerJobZendesk(supabase, jobId, {
    kind: body.kind ?? "assigned",
    reason: body.reason ?? null,
    newStatusLabel: body.newStatusLabel ?? null,
    oldDateLine: body.oldDateLine ?? null,
    oldTimeLine: body.oldTimeLine ?? null,
    newDateLine: body.newDateLine ?? null,
    newTimeLine: body.newTimeLine ?? null,
    skipPush: body.skipPush ?? false,
    actorUserId: auth.user.id,
  });

  /**
   * O parceiro entrou por atribuição direta: avisa os outros dois lados também.
   *
   * Este é o mesmo gesto que o aceite do parceiro em `job-partner-acceptance`,
   * só que pela porta da frente — alguém do time escolheu o parceiro no OS em
   * vez de esperar alguém aceitar a oferta. O job fica igualmente confirmado,
   * então a conta e o morador merecem a mesma notícia.
   *
   * Só em "assigned". Cancelamento, hold e remarcação têm aviso próprio, e
   * disparar uma confirmação de agendamento em cima de um cancelamento seria
   * a pior mensagem possível.
   *
   * Sem depender de `payload.skipped`: os dois envios decidem sozinhos se têm
   * o que fazer. A confirmação da conta não faz nada em job que não veio do
   * Zendesk, e a do cliente é WhatsApp, que não depende do Zendesk. Se a parte
   * do parceiro foi pulada porque o job não tem ticket, o morador ainda assim
   * precisa saber que alguém vai bater na porta dele.
   */
  if ((body.kind ?? "assigned") === "assigned" && status < 400) {
    void dispatchJobCreatedZendesk({ jobId, client: supabase }).catch((e) =>
      console.error("[notify-partner-zendesk] confirmação da conta falhou:", e),
    );
    void enviarConfirmacaoDoCliente(supabase, jobId).catch((e) =>
      console.error("[notify-partner-zendesk] confirmação do cliente falhou:", e),
    );
  }

  return NextResponse.json(payload, { status });
}
