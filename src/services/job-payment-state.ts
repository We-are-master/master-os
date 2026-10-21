import { getSupabase } from "./base";
import { listInstallmentsForInvoiceIds } from "./invoice-payment-plan";
import {
  invoiceFinanceListTodayYmd,
  invoiceIsDerivedOverdue,
  isAwaitingPaymentInvoiceStatus,
} from "@/lib/invoice-finance-tab";
import type { Invoice } from "@/types/database";
import type { JobInvoiceSummary } from "@/lib/job-payment-badge";

/**
 * Das faturas dadas, as que estão vencidas agora. É a mesma regra da aba
 * Overdue do Finance: status `overdue`, ou ainda em cobrança com o vencimento
 * (ou a próxima parcela do plano) no passado. Alimenta a coluna Payment do
 * Jobs Management; nada é gravado.
 */
export type JobInvoicesForPaymentColumn = {
  overdue: Set<string>;
  /** Referência e vencimento de cada fatura, para o hover da etiqueta. */
  byId: Map<string, JobInvoiceSummary>;
};

export async function overdueInvoiceIds(invoiceIds: string[]): Promise<Set<string>> {
  return (await invoicesForPaymentColumn(invoiceIds)).overdue;
}

/** Uma consulta só para a coluna Payment: quais venceram e o que mostrar no hover. */
export async function invoicesForPaymentColumn(invoiceIds: string[]): Promise<JobInvoicesForPaymentColumn> {
  const unique = [...new Set(invoiceIds.filter(Boolean))];
  const out = new Set<string>();
  const byId = new Map<string, JobInvoiceSummary>();
  if (unique.length === 0) return { overdue: out, byId };
  const supabase = getSupabase();
  const rows: Invoice[] = [];
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await supabase
      .from("invoices")
      .select("id, reference, status, due_date")
      .in("id", unique.slice(i, i + 200))
      .is("deleted_at", null);
    if (error) throw error;
    rows.push(...((data ?? []) as Invoice[]));
  }
  for (const inv of rows) byId.set(inv.id, { reference: inv.reference ?? null, dueDate: inv.due_date ?? null });
  const collecting = rows.filter((inv) => isAwaitingPaymentInvoiceStatus(inv.status));
  if (collecting.length === 0) return { overdue: out, byId };
  const plans = await listInstallmentsForInvoiceIds(collecting.map((inv) => inv.id));
  const today = invoiceFinanceListTodayYmd();
  for (const inv of collecting) {
    if (invoiceIsDerivedOverdue(inv, today, plans[inv.id])) out.add(inv.id);
  }
  return { overdue: out, byId };
}
