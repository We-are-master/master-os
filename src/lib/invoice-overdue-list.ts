/**
 * Faturas vencidas para cobrar à mão (home → Action required, cartão "overdue invoices").
 * Saldo em aberto, vencimento antes de hoje (Londres), plataformas fora porque pagam no
 * ciclo delas. Cada uma traz o estágio da cobrança para o botão dizer qual é a próxima.
 *
 * Mora aqui para a rota `/api/invoices/overdue` e o JARVIS contarem do mesmo jeito.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { daysOverdue } from "@/lib/invoice-overdue-reminders";

export type FaturaVencida = {
  id: string;
  reference: string | null;
  clientName: string | null;
  jobReference: string | null;
  balance: number;
  dueDate: string;
  daysOverdue: number;
  stage: number;
  lastChaseAt: string | null;
  sent: boolean;
};

export async function listarFaturasVencidas(sb: SupabaseClient, hoje: string): Promise<FaturaVencida[]> {
  const [{ data: rows }, { data: contas }] = await Promise.all([
    sb
      .from("invoices")
      .select("id, reference, client_name, job_reference, amount, amount_paid, due_date, source_account_id, overdue_reminder_stage, overdue_reminder_last_at, sent_at")
      .is("deleted_at", null)
      .in("status", ["pending", "overdue", "partially_paid", "awaiting_payment"])
      .lt("due_date", hoje)
      .order("due_date", { ascending: true })
      .limit(500),
    sb.from("accounts").select("id").eq("overdue_reminders", false).is("deleted_at", null),
  ]);
  const plataformas = new Set(((contas ?? []) as Array<{ id: string }>).map((a) => a.id));
  type Row = { id: string; reference: string | null; client_name: string | null; job_reference: string | null; amount: number | null; amount_paid: number | null; due_date: string; source_account_id: string | null; overdue_reminder_stage: number | null; overdue_reminder_last_at: string | null; sent_at: string | null };
  const abertas = ((rows ?? []) as Row[]).filter((f) => !(f.source_account_id && plataformas.has(f.source_account_id)));
  // Enviada ao cliente: sent_at (mig 323) ou o email_sent no histórico. Nunca enviada não se cobra: o botão vira "Send invoice".
  const semData = abertas.filter((f) => !f.sent_at).map((f) => f.id);
  const { data: envios } = semData.length
    ? await sb.from("audit_logs").select("entity_id").eq("entity_type", "invoice").eq("field_name", "email_sent").in("entity_id", semData)
    : { data: [] as Array<{ entity_id: string }> };
  const enviadas = new Set(((envios ?? []) as Array<{ entity_id: string }>).map((e) => e.entity_id));
  return abertas
    .map((f) => ({
      id: f.id,
      reference: f.reference,
      clientName: f.client_name,
      jobReference: f.job_reference,
      balance: Math.round((Number(f.amount ?? 0) - Number(f.amount_paid ?? 0)) * 100) / 100,
      dueDate: f.due_date.slice(0, 10),
      daysOverdue: daysOverdue(f.due_date.slice(0, 10), hoje),
      stage: Number(f.overdue_reminder_stage ?? 0),
      lastChaseAt: f.overdue_reminder_last_at,
      sent: Boolean(f.sent_at) || enviadas.has(f.id),
    }))
    .filter((f) => f.balance > 0.02);
}
