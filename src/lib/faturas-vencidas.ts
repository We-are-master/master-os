/**
 * Das faturas dadas, as vencidas agora (24/10/2026). Mesma regra da aba Overdue do
 * Finance e da coluna Payment do Jobs (`invoicesForPaymentColumn`), mas com o cliente
 * do servidor: o espelho do Zendesk roda fora do navegador e grava 🔴 Overdue.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { invoiceFinanceListTodayYmd, invoiceIsDerivedOverdue, isAwaitingPaymentInvoiceStatus } from "@/lib/invoice-finance-tab";
import type { Invoice, InvoicePaymentInstallment } from "@/types/database";

export async function faturasVencidas(sb: SupabaseClient, invoiceIds: readonly (string | null | undefined)[]): Promise<Set<string>> {
  const unicas = [...new Set(invoiceIds.filter((id): id is string => Boolean(id)))];
  const vencidas = new Set<string>();
  if (unicas.length === 0) return vencidas;
  const faturas: Invoice[] = [];
  for (let i = 0; i < unicas.length; i += 200) {
    const { data, error } = await sb.from("invoices").select("id, status, due_date").in("id", unicas.slice(i, i + 200)).is("deleted_at", null);
    if (error) throw error;
    faturas.push(...((data ?? []) as Invoice[]));
  }
  const cobrando = faturas.filter((f) => isAwaitingPaymentInvoiceStatus(f.status));
  if (cobrando.length === 0) return vencidas;
  const parcelas: Record<string, InvoicePaymentInstallment[]> = {};
  const { data: linhas } = await sb.from("invoice_payment_installments").select("*").in("invoice_id", cobrando.map((f) => f.id)).order("sequence", { ascending: true });
  for (const p of (linhas ?? []) as InvoicePaymentInstallment[]) (parcelas[p.invoice_id] ??= []).push(p);
  const hoje = invoiceFinanceListTodayYmd();
  for (const f of cobrando) if (invoiceIsDerivedOverdue(f, hoje, parcelas[f.id])) vencidas.add(f.id);
  return vencidas;
}
