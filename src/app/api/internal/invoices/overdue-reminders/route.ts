/**
 * Lembrete de fatura vencida (dono, 09/10/2026): 1, 3 e 4 dias depois do vencimento em
 * tom amigável e o 4º, no dia 7, como final reminder. Um estágio por fatura por rodada,
 * com a fatura em PDF e o link de pagamento. Plataformas (Housekeep, Fantastic,
 * Checkatrade, Express) ficam fora (`accounts.overdue_reminders = false`).
 * Fatura que nunca foi enviada ao cliente também fica fora: primeiro o envio, depois a cobrança.
 *
 * Chamado pelo n8n uma vez por dia (manhã de Londres). Auth: x-internal-secret =
 * INTERNAL_SYNC_SECRET. ?dry-run=1 só lista o que mandaria.
 */
import { copiasDaFaturaDaConta } from "@/lib/invoice-account-cc";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
import { loadInvoiceSendContext, renderInvoicePdfBuffer } from "@/lib/invoice-send-email";
import { invoiceBalanceDue } from "@/lib/invoice-balance";
import { invoicePayLinkForAmount, invoicePayLinkUrl } from "@/lib/pay-link-url";
import { buildOverdueReminderEmail, daysOverdue, londonTodayYmd, MAX_DIAS_PARA_COMECAR, nextReminderStage } from "@/lib/invoice-overdue-reminders";
import { publicoDaCobranca } from "@/lib/emails/billing-email-common";
import { loadAgentReceiptParty } from "@/lib/agent-model/receipt-party";
import type { Invoice } from "@/types/database";

export const runtime = "nodejs";
export const maxDuration = 60;

const ABERTAS = ["pending", "partially_paid", "overdue", "awaiting_payment"];

function autorizado(dado: string | null): boolean {
  const segredo = process.env.INTERNAL_SYNC_SECRET?.trim();
  if (!segredo || !dado || dado.length !== segredo.length) return false;
  return timingSafeEqual(Buffer.from(dado), Buffer.from(segredo));
}

/** A fatura já foi enviada ao cliente? O envio grava `invoices.sent_at` (mig 323) e `email_sent` no histórico; qualquer um dos dois vale. */
async function faturaJaFoiEnviada(admin: ReturnType<typeof createServiceClient>, invoiceId: string): Promise<boolean> {
  const { count, error } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("entity_type", "invoice")
    .eq("entity_id", invoiceId)
    .eq("field_name", "email_sent");
  // Sem conseguir conferir, não cobra: lembrete errado custa mais do que lembrete atrasado.
  if (error) return false;
  return (count ?? 0) > 0;
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
    const saldo = invoiceBalanceDue({ amount: Number(inv.amount ?? 0), amount_paid: Number(inv.amount_paid ?? 0) });
    if (saldo <= 0.02 || !inv.due_date) continue;
    // Fatura parcelada (mig 326): o atraso é o das parcelas vencidas, não o saldo inteiro.
    const { data: parcelas } = await admin
      .from("invoice_payment_installments")
      .select("amount, due_date, status")
      .eq("invoice_id", inv.id)
      .neq("status", "cancelled");
    const plano = (parcelas ?? []) as { amount: number; due_date: string; status: string }[];
    const vencidas = plano
      .filter((r) => r.status === "pending" && String(r.due_date).slice(0, 10) < today)
      .reduce((acc, r) => acc + Number(r.amount), 0);
    const balance = plano.length > 0 ? Math.min(saldo, Math.round(vencidas * 100) / 100) : saldo;
    if (balance <= 0.02) continue;
    const ultimo = (inv as { overdue_reminder_last_at?: string | null }).overdue_reminder_last_at;
    const desdeUltimo = ultimo ? daysOverdue(londonTodayYmd(new Date(ultimo)), today) : null;
    const atraso = daysOverdue(inv.due_date.slice(0, 10), today);
    const stage = nextReminderStage(inv.overdue_reminder_stage ?? 0, atraso, desdeUltimo);
    if (!stage) {
      if ((inv.overdue_reminder_stage ?? 0) === 0 && atraso > MAX_DIAS_PARA_COMECAR) out.push(`${inv.reference}: ${atraso} days overdue, left for the team (too old to start the sequence)`);
      continue;
    }
    // Job em espera (reclamação, disputa) não recebe cobrança automática.
    if (inv.job_reference) {
      const { data: job } = await admin.from("jobs").select("status, card_charge_status").eq("reference", inv.job_reference).maybeSingle();
      if ((job as { status?: string } | null)?.status === "on_hold") { out.push(`${inv.reference}: skip (job on hold)`); continue; }
      // Cartão recusado já tem a régua própria (dias 1, 3 e 7, cobranca-cartao no Railway):
      // o lembrete de fatura vencida em cima dela mandava dois e-mails de cobrança (22/10/2026).
      if ((job as { card_charge_status?: string | null } | null)?.card_charge_status === "refused") { out.push(`${inv.reference}: skip (card declined: the card dunning handles it)`); continue; }
    }

    // Só cobra o que o cliente já recebeu (dono, 13/10/2026): fatura que nunca foi enviada não gera lembrete.
    // A RCP-2026-904 recebeu "overdue" em 12/10 sem a fatura ter saído uma única vez.
    if (!(inv as { sent_at?: string | null }).sent_at && !(await faturaJaFoiEnviada(admin, inv.id))) { out.push(`${inv.reference}: skip (invoice never sent to the client)`); continue; }

    const ctx = await loadInvoiceSendContext(admin, inv.id);
    if ("error" in ctx) { out.push(`${inv.reference}: skip (${ctx.error.split(" [")[0]})`); continue; }
    if (ctx.billing.sourceAccountId && contasFora.has(ctx.billing.sourceAccountId)) { out.push(`${inv.reference}: skip (platform)`); continue; }
    const to = ctx.billing.documentEmail?.trim();
    if (!to) { out.push(`${inv.reference}: skip (no billing email)`); continue; }

    const payUrl = inv.reference
      ? plano.length > 0
        ? invoicePayLinkForAmount(inv.reference, balance)
        : invoicePayLinkUrl(inv.reference)
      : null;
    // Schedule A (agente): o PDF é "statement"; B: "invoice". O nome do e-mail segue o PDF.
    const agente = await loadAgentReceiptParty(admin, ctx.job).catch(() => null);
    // Copy 15 a 18 na moldura única (um texto por estágio), referência normalizada (INV-).
    const copy = buildOverdueReminderEmail({
      stage,
      publico: publicoDaCobranca(ctx.billing.mode, ctx.billing.displayName, ctx.billing.companyName),
      invoiceReference: inv.reference ?? "",
      amount: balance,
      dueDate: inv.due_date.slice(0, 10),
      documentName: agente ? "statement" : "invoice",
      payUrl,
    });
    if (ensaio) { out.push(`${inv.reference}: would send stage ${stage} (${copy.subject}) to ${to}`); continue; }
    if (!resendKey || !fromEmail) return NextResponse.json({ error: "RESEND_API_KEY / RESEND_FROM_EMAIL not configured" }, { status: 503 });

    const ccDaConta = await copiasDaFaturaDaConta(admin, inv.source_account_id ?? ctx.billing.sourceAccountId ?? null, [to]);
    const pdf = await renderInvoicePdfBuffer(admin, inv.id);
    const resend = new Resend(resendKey);
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: [to],
      // O financeiro da conta acompanha a cobrança, como acompanha a fatura (mig 324).
      ...(ccDaConta.length ? { cc: ccDaConta } : {}),
      replyTo: "hello@getfixfy.com",
      subject: copy.subject,
      html: copy.html,
      text: copy.text,
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
