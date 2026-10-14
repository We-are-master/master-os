import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
import { loadInvoiceSendContext } from "@/lib/invoice-send-email";
import { copiasDaFaturaDaConta } from "@/lib/invoice-account-cc";
import { invoiceBalanceDue } from "@/lib/invoice-balance";
import { invoicePayLinkForAmount } from "@/lib/pay-link-url";
import { londonTodayYmd } from "@/lib/invoice-overdue-reminders";
import type { Invoice } from "@/types/database";

/**
 * Cobrança de cada parcela do cliente (dono, 15/10/2026): job avulso parcelado
 * tem UMA fatura com as parcelas dentro. No dia de cada parcela, o cliente
 * recebe um e-mail com o valor dela e o link da Stripe daquele valor exato.
 * Uma vez por parcela (`requested_at`, mig 326). Depois disso, quem cobra o
 * atraso é o lembrete de fatura vencida, que passa a falar da parcela.
 *
 *   GET /api/cron/parcelas-cliente            manda
 *   GET /api/cron/parcelas-cliente?dry-run=1  só lista
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://app.getfixfy.com/api/cron/parcelas-cliente?dry-run=1"
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

function secretsMatch(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Rascunho NÃO fica fora: no avulso parcelado a fatura nasce em rascunho junto
 * com o job e as parcelas vencem antes da conclusão. O plano é o combinado, e o
 * /pay aceita fatura em rascunho.
 */
const FECHADAS = new Set(["paid", "cancelled"]);

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!secretsMatch(bearer, process.env.CRON_SECRET?.trim())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ensaio = req.nextUrl.searchParams.get("dry-run") === "1";
  const admin = createServiceClient();
  const today = londonTodayYmd();

  const { data: parcelas, error } = await admin
    .from("invoice_payment_installments")
    .select("id, invoice_id, sequence, amount, due_date, status")
    .eq("status", "pending")
    .is("requested_at", null)
    .lte("due_date", today)
    .order("due_date", { ascending: true })
    .limit(80);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const resendKey = process.env.RESEND_API_KEY?.trim();
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();
  const out: string[] = [];

  for (const p of (parcelas ?? []) as { id: string; invoice_id: string; sequence: number; amount: number; due_date: string }[]) {
    const { data: invRow } = await admin.from("invoices").select("*").eq("id", p.invoice_id).maybeSingle();
    const inv = invRow as (Invoice & { source_account_id?: string | null }) | null;
    if (!inv || inv.deleted_at) continue;
    const tag = `${inv.reference} #${p.sequence}`;
    // Escolhido ao criar a cobrança (mig 326): sem isto, quem pede a parcela é o escritório.
    if ((inv as { instalments_auto_charge?: boolean }).instalments_auto_charge !== true) continue;
    if (FECHADAS.has(String(inv.status))) { out.push(`${tag}: skip (invoice ${inv.status})`); continue; }
    const saldo = invoiceBalanceDue({ amount: Number(inv.amount ?? 0), amount_paid: Number(inv.amount_paid ?? 0) });
    const valor = Math.min(Math.round(Number(p.amount) * 100) / 100, saldo);
    if (valor <= 0.02) { out.push(`${tag}: skip (nothing open)`); continue; }

    let jobId: string | null = null;
    if (inv.job_reference) {
      const { data: job } = await admin.from("jobs").select("id, status").eq("reference", inv.job_reference).maybeSingle();
      jobId = (job as { id?: string } | null)?.id ?? null;
      const st = (job as { status?: string } | null)?.status;
      if (st === "on_hold" || st === "cancelled") { out.push(`${tag}: skip (job ${st})`); continue; }
    }

    const ctx = await loadInvoiceSendContext(admin, inv.id);
    if ("error" in ctx) { out.push(`${tag}: skip (${ctx.error.split(" [")[0]})`); continue; }
    const to = ctx.billing.documentEmail?.trim();
    if (!to) { out.push(`${tag}: skip (no billing email)`); continue; }

    const { count: total } = await admin
      .from("invoice_payment_installments")
      .select("id", { count: "exact", head: true })
      .eq("invoice_id", inv.id)
      .neq("status", "cancelled");
    const payUrl = inv.reference ? invoicePayLinkForAmount(inv.reference, valor) : null;
    const dueLabel = new Date(`${p.due_date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London",
    });
    const jobLabel = ctx.job?.reference ?? inv.job_reference ?? "your job";
    const subject = `Instalment ${p.sequence} of ${total ?? p.sequence} · £${valor.toFixed(2)} · ${inv.reference}`;
    if (ensaio) { out.push(`${tag}: would request £${valor.toFixed(2)} from ${to}`); continue; }
    if (!resendKey || !fromEmail) return NextResponse.json({ error: "RESEND_API_KEY / RESEND_FROM_EMAIL not configured" }, { status: 503 });

    const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a2e;max-width:560px">
<p>Hi ${esc(ctx.billing.displayName ?? "there")},</p>
<p>Instalment ${p.sequence} of ${total ?? p.sequence} for ${esc(jobLabel)} is due today, ${esc(dueLabel)}: <strong>£${valor.toFixed(2)}</strong>.</p>
${payUrl ? `<p><a href="${payUrl}" style="display:inline-block;background:#ED4B00;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Pay £${valor.toFixed(2)} now</a></p>` : ""}
<p>Bank transfer: GETFIXFY LTD · sort code 04-00-03 · account 06913415 · reference ${esc(inv.reference ?? "")}.</p>
<p>Thank you,<br>Fixfy Team</p></div>`;

    const cc = await copiasDaFaturaDaConta(admin, inv.source_account_id ?? ctx.billing.sourceAccountId ?? null, [to]);
    const { error: sendErr } = await new Resend(resendKey).emails.send({
      from: fromEmail,
      to: [to],
      ...(cc.length ? { cc } : {}),
      replyTo: "hello@getfixfy.com",
      subject,
      html,
    });
    if (sendErr) { out.push(`${tag}: send failed`); continue; }

    await admin.from("invoice_payment_installments").update({ requested_at: new Date().toISOString() }).eq("id", p.id);
    // Parcela nova, régua de atraso nova: o lembrete recomeça do 1º estágio para esta parcela.
    await admin.from("invoices").update({ overdue_reminder_stage: 0, overdue_reminder_last_at: null }).eq("id", inv.id);
    await admin.from("audit_logs").insert({
      entity_type: "invoice", entity_id: inv.id, entity_ref: inv.reference, action: "bulk_update",
      field_name: "instalment_requested", new_value: String(p.sequence), metadata: { to, amount: valor },
    });
    if (jobId) {
      await admin.from("audit_logs").insert({
        entity_type: "job", entity_id: jobId, entity_ref: inv.job_reference, action: "note",
        field_name: "instalments",
        metadata: {
          title: `Instalment ${p.sequence} of ${total ?? p.sequence} requested · £${valor.toFixed(2)}`,
          detail: `Email with a pay link sent automatically to ${to}${cc.length ? ` (cc ${cc.join(", ")})` : ""}. Invoice ${inv.reference}.`,
        },
      });
    }
    out.push(`${tag}: requested £${valor.toFixed(2)} from ${to}`);
  }
  return NextResponse.json({ ok: true, ensaio, today, results: out });
}
