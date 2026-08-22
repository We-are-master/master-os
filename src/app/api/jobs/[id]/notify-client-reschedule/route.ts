import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuth } from "@/lib/auth-api";
import { buildClientJobRescheduledEmail } from "@/lib/emails/client-job-rescheduled";
import { mensagensAoClienteLigadas } from "@/lib/client-confirmation/policy";
import { resolveNominalBillingParty } from "@/lib/account-billing-addressee";
import { buildJobRescheduledHtml, splitPropertyAddressAndPostcode } from "@/lib/zendesk-job-confirmation";

/**
 * POST /api/jobs/[id]/notify-client-reschedule
 *
 * Avisa o CLIENTE que a data mudou. O par disto para o parceiro já existe em
 * `notify-partner-zendesk` com `kind: "rescheduled"`, e é chamado dos mesmos
 * pontos da tela: quem remarca avisa os dois lados no mesmo gesto.
 *
 * Vai por email e não por WhatsApp de propósito. Remarcação carrega duas datas
 * e um motivo, e template do WhatsApp é texto fixo com variáveis: caberia mal
 * e ainda dependeria de aprovação da Meta a cada mudança de texto. Email é
 * livre, e é onde o cliente guarda a data.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Corpo = {
  oldDateLine?: string;
  oldTimeLine?: string | null;
  newDateLine?: string;
  newTimeLine?: string | null;
  reason?: string | null;
};

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  const supabase = createServiceClient();
  const body = (await req.json().catch(() => ({}))) as Corpo;

  const { data: job } = await supabase
    .from("jobs")
    .select("id, reference, title, property_address, client_id, client_name, client_reschedule_notified_at")
    .eq("id", id)
    .maybeSingle();
  if (!job) return NextResponse.json({ ok: false, error: "job_not_found" }, { status: 404 });
  const j = job as unknown as Record<string, unknown>;

  const clientId = typeof j.client_id === "string" ? j.client_id : "";
  if (!clientId) return NextResponse.json({ ok: false, skipped: "job has no client" }, { status: 200 });

  // Mesmo resolvedor de destinatário que fatura e orçamento usam: em conta B2B
  // o email vai para a conta, em B2C para o cliente. Sem isto a remarcação
  // seria o único email do sistema com regra própria de destinatário.
  const billing = await resolveNominalBillingParty(supabase, {
    clientId,
    fallbackName: String(j.client_name ?? ""),
  });
  const para = billing.documentEmail?.trim() ?? "";
  if (!para) {
    return NextResponse.json({ ok: false, skipped: "no email for this customer" }, { status: 200 });
  }

  /**
   * A trava de mensagens vale para o MORADOR, não para a conta.
   *
   * `CLIENT_MESSAGING_ENABLED` existe para segurar mensagem a cliente final
   * enquanto o processo não foi validado ponta a ponta, e ela é sobre WhatsApp
   * para quem abre a porta. A conta é outra coisa: já recebe a confirmação de
   * agendamento sem trava nenhuma, e é ela quem prometeu uma data ao morador.
   *
   * Deixar a remarcação da conta atrás dessa trava era o pior dos dois mundos:
   * a Housekeep sabia do job quando foi marcado e não sabia quando mudou. Foi
   * o JOB-9466 em 20/08/2026, e virou reclamação do Checkatrade.
   */
  const paraAConta = billing.mode === "account";
  if (!paraAConta && !mensagensAoClienteLigadas()) {
    return NextResponse.json(
      { ok: false, skipped: "client messaging is off (CLIENT_MESSAGING_ENABLED)" },
      { status: 200 },
    );
  }

  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return NextResponse.json({ ok: false, skipped: "RESEND_API_KEY not set" }, { status: 200 });

  const primeiroNome = String(billing.displayName || j.client_name || "").trim().split(/\s+/)[0] || "there";

  /**
   * Conta e morador leem layouts diferentes de propósito.
   *
   * A conta recebe a MESMA moldura do email de confirmação que ela já conhece:
   * compacta, sem explicar como o serviço funciona, porque ela nos manda job
   * toda semana. O morador recebe o layout de cliente, que tem espaço para
   * motivo e para o tom de quem está sendo remarcado.
   */
  if (paraAConta) {
    const { propertyAddress, propertyPostcode } = splitPropertyAddressAndPostcode(
      String(j.property_address ?? ""),
    );
    const html = buildJobRescheduledHtml({
      greetingName: billing.displayName || String(j.client_name ?? "there"),
      jobReference: String(j.reference ?? ""),
      jobTitle: String(j.title ?? ""),
      jobDate: body.newDateLine ?? "New date",
      arrivalWindow: body.newTimeLine ?? "To be confirmed",
      previousDate: body.oldDateLine ?? "Previous date",
      previousArrivalWindow: body.oldTimeLine ?? undefined,
      propertyAddress,
      propertyPostcode,
      typeOfWork: String(j.title ?? ""),
    });
    const key = process.env.RESEND_API_KEY?.trim();
    if (!key) return NextResponse.json({ ok: false, skipped: "RESEND_API_KEY not set" }, { status: 200 });
    try {
      const { error } = await new Resend(key).emails.send({
        from: process.env.RESEND_FROM_EMAIL?.trim() || "Fixfy <ops@getfixfy.com>",
        to: [para],
        subject: `Job rescheduled — ${String(j.reference ?? "")}`,
        html,
      });
      if (error) return NextResponse.json({ ok: false, error: error.message ?? "send failed" }, { status: 502 });
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : "send failed" },
        { status: 502 },
      );
    }
    await supabase
      .from("jobs")
      .update({ client_reschedule_notified_at: new Date().toISOString(), client_reminder_sent_at: null })
      .eq("id", id);
    return NextResponse.json({ ok: true, to: para, layout: "account" });
  }

  const email = buildClientJobRescheduledEmail({
    clientFirstName: primeiroNome,
    jobReference: String(j.reference ?? ""),
    jobTitle: String(j.title ?? ""),
    propertyAddress: String(j.property_address ?? ""),
    oldDateLine: body.oldDateLine ?? "Previous date",
    oldTimeLine: body.oldTimeLine ?? null,
    newDateLine: body.newDateLine ?? "New date",
    newTimeLine: body.newTimeLine ?? null,
    reason: body.reason ?? null,
  });

  try {
    const { error } = await new Resend(key).emails.send({
      from: process.env.RESEND_FROM_EMAIL?.trim() || "Fixfy <ops@getfixfy.com>",
      to: [para],
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    if (error) {
      return NextResponse.json({ ok: false, error: error.message ?? "send failed" }, { status: 502 });
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "send failed" },
      { status: 502 },
    );
  }

  // O lembrete de véspera precisa valer para a data NOVA, então o carimbo dele
  // é zerado aqui. Sem isto, um job remarcado nunca receberia lembrete: a
  // varredura pula quem já tem `client_reminder_sent_at` preenchido.
  await supabase
    .from("jobs")
    .update({
      client_reschedule_notified_at: new Date().toISOString(),
      client_reminder_sent_at: null,
    })
    .eq("id", id);

  return NextResponse.json({ ok: true, to: para });
}
