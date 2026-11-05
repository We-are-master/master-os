/**
 * Envio de uma cobrança de fatura vencida, num lugar só (05/11/2026). Usado pela rodada
 * diária (`/api/internal/invoices/overdue-reminders`) e pelo botão manual do Overview
 * (`/api/invoices/[id]/chase`): o mesmo e-mail, o mesmo PDF, o mesmo registro.
 */
import { Resend } from "resend";
import type { createServiceClient } from "@/lib/supabase/service";
import { copiasDaFaturaDaConta } from "@/lib/invoice-account-cc";
import { loadInvoiceSendContext, renderInvoicePdfBuffer } from "@/lib/invoice-send-email";
import { invoiceBalanceDue } from "@/lib/invoice-balance";
import { invoicePayLinkForAmount, invoicePayLinkUrl } from "@/lib/pay-link-url";
import { buildOverdueReminderEmail } from "@/lib/invoice-overdue-reminders";
import { publicoDaCobranca } from "@/lib/emails/billing-email-common";
import { loadAgentReceiptParty } from "@/lib/agent-model/receipt-party";
import type { Invoice } from "@/types/database";

type Admin = ReturnType<typeof createServiceClient>;
export type FaturaCobravel = Invoice & { overdue_reminder_stage?: number; overdue_reminder_last_at?: string | null; source_account_id?: string | null; sent_at?: string | null };
export type Parcela = { amount: number; due_date: string; status: string };

/** O saldo que está vencido: a fatura inteira, ou só as parcelas vencidas quando é parcelada (mig 326). */
export async function saldoVencidoDaFatura(admin: Admin, inv: FaturaCobravel, hoje: string): Promise<{ balance: number; plano: Parcela[] }> {
  const saldo = invoiceBalanceDue({ amount: Number(inv.amount ?? 0), amount_paid: Number(inv.amount_paid ?? 0) });
  if (saldo <= 0.02) return { balance: 0, plano: [] };
  const { data: parcelas } = await admin.from("invoice_payment_installments").select("amount, due_date, status").eq("invoice_id", inv.id).neq("status", "cancelled");
  const plano = (parcelas ?? []) as Parcela[];
  const vencidas = plano.filter((r) => r.status === "pending" && String(r.due_date).slice(0, 10) < hoje).reduce((acc, r) => acc + Number(r.amount), 0);
  const balance = plano.length > 0 ? Math.min(saldo, Math.round(vencidas * 100) / 100) : saldo;
  return { balance, plano };
}

/** A fatura já foi enviada ao cliente? O envio grava `invoices.sent_at` (mig 323) e `email_sent` no histórico. */
export async function faturaJaFoiEnviada(admin: Admin, inv: FaturaCobravel): Promise<boolean> {
  if (inv.sent_at) return true;
  const { count, error } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("entity_type", "invoice")
    .eq("entity_id", inv.id)
    .eq("field_name", "email_sent");
  // Sem conseguir conferir, não cobra: lembrete errado custa mais do que lembrete atrasado.
  if (error) return false;
  return (count ?? 0) > 0;
}

export type ResultadoCobranca = { ok: true; to: string; subject: string; enviado: boolean } | { ok: false; motivo: string };

/**
 * Monta e (fora do ensaio) manda o estágio `stage` da cobrança, grava o estágio na fatura
 * e o registro no histórico. Não decide SE cobra: quem chama já conferiu job em espera,
 * cartão recusado e o envio da fatura.
 */
export async function enviarEstagioDeCobranca(
  admin: Admin,
  inv: FaturaCobravel,
  stage: number,
  balance: number,
  plano: Parcela[],
  opts: { ensaio?: boolean; contasFora?: Set<string>; manual?: { userId: string; userName: string } } = {},
): Promise<ResultadoCobranca> {
  const ctx = await loadInvoiceSendContext(admin, inv.id);
  if ("error" in ctx) return { ok: false, motivo: ctx.error.split(" [")[0] };
  if (ctx.billing.sourceAccountId && opts.contasFora?.has(ctx.billing.sourceAccountId)) return { ok: false, motivo: "platform" };
  const to = ctx.billing.documentEmail?.trim();
  if (!to) return { ok: false, motivo: "no billing email" };

  const payUrl = inv.reference ? (plano.length > 0 ? invoicePayLinkForAmount(inv.reference, balance) : invoicePayLinkUrl(inv.reference)) : null;
  // Schedule A (agente): o PDF é "statement"; B: "invoice". O nome do e-mail segue o PDF.
  const agente = await loadAgentReceiptParty(admin, ctx.job).catch(() => null);
  const copy = buildOverdueReminderEmail({
    stage,
    publico: publicoDaCobranca(ctx.billing.mode, ctx.billing.displayName, ctx.billing.companyName),
    invoiceReference: inv.reference ?? "",
    amount: balance,
    dueDate: inv.due_date.slice(0, 10),
    documentName: agente ? "statement" : "invoice",
    payUrl,
  });
  if (opts.ensaio) return { ok: true, to, subject: copy.subject, enviado: false };

  const resendKey = process.env.RESEND_API_KEY?.trim();
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();
  if (!resendKey || !fromEmail) return { ok: false, motivo: "RESEND_API_KEY / RESEND_FROM_EMAIL not configured" };

  const ccDaConta = await copiasDaFaturaDaConta(admin, inv.source_account_id ?? ctx.billing.sourceAccountId ?? null, [to]);
  const pdf = await renderInvoicePdfBuffer(admin, inv.id);
  const { error } = await new Resend(resendKey).emails.send({
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
  if (error) return { ok: false, motivo: "send failed" };

  await admin
    .from("invoices")
    .update({ overdue_reminder_stage: stage, overdue_reminder_last_at: new Date().toISOString(), ...(inv.status === "pending" ? { status: "overdue" } : {}) })
    .eq("id", inv.id);
  await admin.from("audit_logs").insert({
    entity_type: "invoice",
    entity_id: inv.id,
    entity_ref: inv.reference,
    action: "bulk_update",
    field_name: "overdue_reminder",
    new_value: String(stage),
    ...(opts.manual ? { user_id: opts.manual.userId, user_name: opts.manual.userName } : {}),
    metadata: { to, final: copy.final, ...(opts.manual ? { manual: true } : {}) },
  });
  return { ok: true, to, subject: copy.subject, enviado: true };
}
