import { getSupabase } from "./base";
import { listInstallmentsForInvoiceIds } from "./invoice-payment-plan";
import {
  invoiceFinanceListTodayYmd,
  invoiceIsDerivedOverdue,
  isAwaitingPaymentInvoiceStatus,
} from "@/lib/invoice-finance-tab";
import type { Invoice } from "@/types/database";

/**
 * Das faturas dadas, as que estão vencidas agora. É a mesma regra da aba
 * Overdue do Finance: status `overdue`, ou ainda em cobrança com o vencimento
 * (ou a próxima parcela do plano) no passado. Alimenta a coluna Payment do
 * Jobs Management; nada é gravado.
 */
export async function overdueInvoiceIds(invoiceIds: string[]): Promise<Set<string>> {
  const unique = [...new Set(invoiceIds.filter(Boolean))];
  const out = new Set<string>();
  if (unique.length === 0) return out;
  const supabase = getSupabase();
  const rows: Invoice[] = [];
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await supabase
      .from("invoices")
      .select("id, status, due_date")
      .in("id", unique.slice(i, i + 200))
      .is("deleted_at", null);
    if (error) throw error;
    rows.push(...((data ?? []) as Invoice[]));
  }
  const collecting = rows.filter((inv) => isAwaitingPaymentInvoiceStatus(inv.status));
  if (collecting.length === 0) return out;
  const plans = await listInstallmentsForInvoiceIds(collecting.map((inv) => inv.id));
  const today = invoiceFinanceListTodayYmd();
  for (const inv of collecting) {
    if (invoiceIsDerivedOverdue(inv, today, plans[inv.id])) out.add(inv.id);
  }
  return out;
}
