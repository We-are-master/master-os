import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendInvoiceEmail } from "@/lib/invoice-send-email";
import { accountAllowsChargeOnCreate } from "@/lib/charge-on-create";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/jobs/[id]/charge-on-create  { percent: 1..100 }
 *
 * Cobrança na criação do job (dono, 13/10/2026): quem cria o job escolhe total,
 * sinal (com a porcentagem) ou na conclusão. Nos dois primeiros, o cliente recebe
 * na hora o e-mail com o valor, o botão de pagar e os dados de transferência.
 *
 * É o mesmo envio do "Request payment" do job, então a fatura fica marcada como
 * enviada (`sent_at`) e passa a valer para o lembrete de vencida.
 *
 * Plataformas (Housekeep, Express, Fantastic) nunca recebem: o morador é cliente
 * delas. A trava é a mesma do e-mail de conclusão, `email_include_invoice_on_final`.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id: jobId } = await ctx.params;
  if (!isValidUUID(jobId)) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });

  let body: { percent?: unknown };
  try {
    body = (await req.json()) as { percent?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const percent = Math.round(Number(body.percent));
  if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
    return NextResponse.json({ error: "percent must be between 1 and 100" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { data: job } = await admin
    .from("jobs")
    .select("id, reference, client_id, invoice_id")
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const j = job as { id: string; reference: string; client_id: string | null; invoice_id: string | null };

  const allowed = await accountAllowsChargeOnCreate(admin, j.client_id);
  if (!allowed.ok) return NextResponse.json({ error: allowed.reason }, { status: 400 });

  // A fatura nasce em paralelo com o job: espera um pouco por ela antes de desistir.
  let invoiceId = j.invoice_id;
  for (let i = 0; i < 6 && !invoiceId; i++) {
    const { data: inv } = await admin
      .from("invoices")
      .select("id")
      .eq("job_reference", j.reference)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    invoiceId = (inv as { id?: string } | null)?.id ?? null;
    if (!invoiceId) await new Promise((ok) => setTimeout(ok, 1000));
  }
  if (!invoiceId) return NextResponse.json({ error: "The invoice for this job is not ready yet. Use Request payment on the job." }, { status: 409 });

  const profileClient = await createClient();
  const { data: profile } = await profileClient.from("profiles").select("full_name").eq("id", auth.user.id).maybeSingle();
  const userName = (profile as { full_name?: string | null } | null)?.full_name?.trim() || auth.user.email || "User";

  const result = await sendInvoiceEmail(admin, invoiceId, {
    userId: auth.user.id,
    userName,
    requestPercent: percent >= 100 ? undefined : percent,
    jobId: j.id,
    variant: "booking",
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, to: result.to, percent });
}
