/**
 * O pagamento da fatura semanal (fatura-semanal.ts), separado para rodar também no
 * navegador ("mark paid" da tela de Billing): sem crypto nem link de relatório aqui.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job } from "@/types/database";
import { jobCustomerTotal } from "@/lib/job-financials";

const EPS = 0.02;
const CLIENTE = ["customer_deposit", "customer_final"];

export type Pagamento = { job_id: string; type: string; amount: number; linked_invoice_id?: string | null };

export async function pagamentosDoCliente(admin: SupabaseClient, jobIds: string[]): Promise<Pagamento[]> {
  if (!jobIds.length) return [];
  const { data } = await admin
    .from("job_payments")
    .select("job_id, type, amount, linked_invoice_id")
    .in("job_id", jobIds)
    .in("type", CLIENTE)
    .is("deleted_at", null);
  return (data ?? []) as Pagamento[];
}

/** O que cada job deve, sem contar o que já entrou por esta fatura (para o PDF bater depois de pago). */
export function devidoNaFatura(job: Job, pags: Pagamento[], invoiceId: string | null): number {
  const pagoFora = pags
    .filter((p) => p.job_id === job.id && (!invoiceId || p.linked_invoice_id !== invoiceId))
    .reduce((s, p) => s + Number(p.amount || 0), 0);
  return Math.max(0, Math.round((jobCustomerTotal(job) - pagoFora) * 100) / 100);
}



/**
 * Reparte um pagamento da fatura semanal entre os jobs dela (o mais antigo primeiro) e
 * fecha cada job quitado. `etiqueta` identifica o pagamento (sessão da Stripe ou "Manual")
 * e torna a chamada idempotente: repetir não lança de novo.
 */
export async function repartirPagamentoDaFaturaSemanal(
  admin: SupabaseClient,
  invoiceId: string,
  valor: number,
  etiqueta: string,
  opts: { atualizarFatura: boolean },
): Promise<{ aplicado: number; jobsQuitados: string[]; repetido: boolean }> {
  const { data: invRow } = await admin.from("invoices").select("id, reference, amount, amount_paid, status").eq("id", invoiceId).maybeSingle();
  const inv = invRow as { id: string; reference: string; amount: number; amount_paid: number | null; status: string } | null;
  if (!inv) return { aplicado: 0, jobsQuitados: [], repetido: false };

  const nota = `${etiqueta} · ${inv.reference}`;
  const { data: ja } = await admin.from("job_payments").select("id").eq("linked_invoice_id", invoiceId).eq("note", nota).is("deleted_at", null).limit(1);
  if ((ja ?? []).length) return { aplicado: 0, jobsQuitados: [], repetido: true };

  const { data: dosJobs } = await admin.from("jobs").select("*").eq("invoice_id", invoiceId).is("deleted_at", null).order("completed_date", { ascending: true });
  const jobs = (dosJobs ?? []) as Job[];
  const pags = await pagamentosDoCliente(admin, jobs.map((j) => j.id));
  const linhas = jobs.map((j) => ({ jobId: j.id, reference: String(j.reference ?? ""), amount: devidoNaFatura(j, pags, invoiceId) }));
  let resta = Math.round(valor * 100) / 100;
  let aplicado = 0;
  const quitados: string[] = [];
  const hoje = new Date().toISOString().slice(0, 10);
  for (const l of linhas) {
    if (resta <= EPS) break;
    const jaNestaFatura = pags.filter((p) => p.job_id === l.jobId && p.linked_invoice_id === invoiceId).reduce((s, p) => s + Number(p.amount || 0), 0);
    const falta = Math.max(0, Math.round((l.amount - jaNestaFatura) * 100) / 100);
    if (falta <= EPS) continue;
    const parte = Math.min(falta, resta);
    const { error } = await admin.from("job_payments").insert({
      job_id: l.jobId,
      type: "customer_final",
      amount: Math.round(parte * 100) / 100,
      payment_date: hoje,
      note: nota,
      linked_invoice_id: invoiceId,
    });
    if (error) {
      console.error("[fatura-semanal] pagamento", l.reference, error.message);
      continue;
    }
    resta = Math.round((resta - parte) * 100) / 100;
    aplicado = Math.round((aplicado + parte) * 100) / 100;
    if (parte >= falta - EPS) quitados.push(l.jobId);
  }

  if (opts.atualizarFatura && aplicado > EPS) {
    const pago = Math.min(Number(inv.amount), Math.round((Number(inv.amount_paid ?? 0) + aplicado) * 100) / 100);
    const quitada = pago >= Number(inv.amount) - EPS;
    await admin
      .from("invoices")
      .update({ amount_paid: pago, status: quitada ? "paid" : "partially_paid", ...(quitada ? { paid_date: hoje } : {}) })
      .eq("id", invoiceId);
  }
  const { finalizeJobAfterInvoicePaid } = await import("@/lib/sync-job-after-invoice-paid");
  for (const jobId of quitados) await finalizeJobAfterInvoicePaid(admin, jobId).catch((e) => console.error("[fatura-semanal] finalize", e));
  return { aplicado, jobsQuitados: quitados, repetido: false };
}

/** A fatura é um lote semanal? (quem trata pagamento desvia para o repasse acima) */
export async function ehFaturaSemanal(admin: SupabaseClient, invoiceId: string): Promise<boolean> {
  const { data } = await admin.from("invoices").select("invoice_kind").eq("id", invoiceId).maybeSingle();
  return (data as { invoice_kind?: string | null } | null)?.invoice_kind === "weekly_batch";
}
