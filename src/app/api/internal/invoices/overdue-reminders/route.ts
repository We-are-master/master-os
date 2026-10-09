/**
 * Lembrete de fatura vencida (dono, 09/10/2026): 1, 3 e 4 dias depois do vencimento em
 * tom amigável e o 4º, no dia 7, como final reminder. Um estágio por fatura por rodada,
 * com a fatura em PDF e o link de pagamento. Plataformas (Housekeep, Fantastic,
 * Checkatrade, Express) ficam fora (`accounts.overdue_reminders = false`).
 *
 * Chamado pelo n8n uma vez por dia (manhã de Londres). Auth: x-internal-secret =
 * INTERNAL_SYNC_SECRET. ?dry-run=1 só lista o que mandaria.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
import { loadInvoiceSendContext, renderInvoicePdfBuffer } from "@/lib/invoice-send-email";
import { invoiceBalanceDue } from "@/lib/invoice-balance";
import { invoicePayLinkUrl } from "@/lib/pay-link-url";
import { daysOverdue, londonTodayYmd, nextReminderStage, reminderCopy } from "@/lib/invoice-overdue-reminders";
import type { Invoice } from "@/types/database";

export const runtime = "nodejs";
export const maxDuration = 60;

const ABERTAS = ["pending", "partially_paid", "overdue", "awaiting_payment"];

function autorizado(dado: string | null): boolean {
  const segredo = process.env.INTERNAL_SYNC_SECRET?.trim();
  if (!segredo || !dado || dado.length !== segredo.length) return false;
  return timingSafeEqual(Buffer.from(dado), Buffer.from(segredo));
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function POST(req: NextRequest) {
  if (!autorizado(req.headers.get("x-internal-secret"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ensaio = req.nextUrl.searchParams.get("dry-run") === "1";
  const admin = createServiceClient();
  const today = londonTodayYmd();

  const { data: rows } = await admin
    .from("invoices")
    .select("*")
    .in("status", ABERTAS)
    .is("deleted_at", null)
    .lt("due_date", today)
    .lt("overdue_reminder_stage", 4)
    .order("due_date", { ascending: true })
    .limit(60);

  const { data: semLembrete } = await admin.from("accounts").select("id").eq("overdue_reminders", false);
  const contasFora = new Set(((semLembrete ?? []) as { id: string }[]).map((a) => a.id));

  const resendKey = process.env.RESEND_API_KEY?.trim();
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();
  const out: string[] = [];

  for (const inv of (rows ?? []) as (Invoice & { overdue_reminder_stage?: number; source_account_id?: string | null })[]) {
    const balance = invoiceBalanceDue({ amount: Number(inv.amount ?? 0), amount_paid: Number(inv.amount_paid ?? 0) });
    if (balance <= 0.02 || !inv.due_date) continue;
    const stage = nextReminderStage(inv.overdue_reminder_stage ?? 0, daysOverdue(inv.due_date.slice(0, 10), today));
    if (!stage) continue;

    const ctx = await loadInvoiceSendContext(admin, inv.id);
    if ("error" in ctx) { out.push(`${inv.reference}: skip (${ctx.error.split(" [")[0]})`); continue; }
    if (ctx.billing.sourceAccountId && contasFora.has(ctx.billing.sourceAccountId)) { out.push(`${inv.reference}: skip (platform)`); continue; }
    const to = ctx.billing.documentEmail?.trim();
    if (!to) { out.push(`${inv.reference}: skip (no billing email)`); continue; }

    const dueLabel = new Date(`${inv.due_date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
    const payUrl = inv.reference ? invoicePayLinkUrl(inv.reference) : null;
    const copy = reminderCopy(stage, {
      name: ctx.billing.displayName ?? "there",
      reference: inv.reference ?? "",
      amount: `£${balance.toFixed(2)}`,
      dueLabel,
      jobLabel: ctx.job?.reference ?? inv.job_reference ?? "your job",
      payUrl,
    });
    if (ensaio) { out.push(`${inv.reference}: would send stage ${stage} (${copy.subject}) to ${to}`); continue; }
    if (!resendKey || !fromEmail) return NextResponse.json({ error: "RESEND_API_KEY / RESEND_FROM_EMAIL not configured" }, { status: 503 });

    const pdf = await renderInvoicePdfBuffer(admin, inv.id);
    const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a2e;max-width:560px">
<p>Hi ${esc(ctx.billing.displayName ?? "there")},</p>
<p>${esc(copy.opening)}</p>
${payUrl ? `<p><a href="${payUrl}" style="display:inline-block;background:${copy.final ? "#020040" : "#ED4B00"};color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Pay £${balance.toFixed(2)} now</a></p>` : ""}
<p>Bank transfer: GETFIXFY LTD · sort code 04-00-03 · account 06913415 · reference ${esc(inv.reference ?? "")}.</p>
<p>${esc(copy.closing)}</p>
<p>Thank you,<br>Fixfy Team</p></div>`;

    const resend = new Resend(resendKey);
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: [to],
      replyTo: "hello@getfixfy.com",
      subject: copy.subject,
      html,
      ...("error" in pdf ? {} : { attachments: [{ filename: `${pdf.reference.replace(/[^\w.-]+/g, "_")}.pdf`, content: pdf.buffer, contentType: "application/pdf" }] }),
    });
    if (error) { out.push(`${inv.reference}: send failed`); continue; }

    await admin
      .from("invoices")
      .update({ overdue_reminder_stage: stage, overdue_reminder_last_at: new Date().toISOString(), ...(inv.status === "pending" ? { status: "overdue" } : {}) })
      .eq("id", inv.id);
    await admin.from("audit_logs").insert({
      entity_type: "invoice", entity_id: inv.id, entity_ref: inv.reference, action: "bulk_update",
      field_name: "overdue_reminder", new_value: String(stage), metadata: { to, final: copy.final },
    });
    out.push(`${inv.reference}: sent stage ${stage} to ${to}`);
  }
  return NextResponse.json({ ok: true, ensaio, today, results: out });
}
