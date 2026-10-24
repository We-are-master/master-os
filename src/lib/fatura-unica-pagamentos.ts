import type { Invoice } from "@/types/database";

/** Fatura que conta para o job: não cancelada e não é a fatura semanal (batch). */
function contaParaOJob(inv: Pick<Invoice, "status" | "invoice_kind">): boolean {
  return inv.status !== "cancelled" && inv.invoice_kind !== "weekly_batch";
}

/**
 * A única fatura que conta para o job, ou null quando há zero ou mais de uma
 * (sinal e saldo em faturas separadas: aí o pagamento não pode ir para uma só).
 */
export function faturaUnicaDoJob<T extends Pick<Invoice, "id" | "status" | "invoice_kind">>(faturas: T[]): T | null {
  const validas = faturas.filter(contaParaOJob);
  return validas.length === 1 ? validas[0]! : null;
}

export type PagamentoDoJob = { type: string; amount: number | string; linked_invoice_id?: string | null };

/**
 * Quanto a fatura única do job já recebeu: todo pagamento de cliente do job, menos o
 * que está vinculado a OUTRA fatura. O "Record payment received" da tela do job não
 * gravava `linked_invoice_id`, e a soma só pelos vinculados deixava esses de fora
 * (JOB-9708, 24/10/2026: fatura em £2.236 com £4.353,28 recebidos).
 */
export function pagoNaFaturaUnica(pagamentos: PagamentoDoJob[], invoiceId: string): number {
  const total = pagamentos
    .filter((p) => p.type === "customer_deposit" || p.type === "customer_final")
    .filter((p) => !p.linked_invoice_id || p.linked_invoice_id === invoiceId)
    .reduce((s, p) => s + Number(p.amount || 0), 0);
  return Math.round(total * 100) / 100;
}
