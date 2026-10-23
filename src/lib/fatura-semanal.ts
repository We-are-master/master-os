/**
 * Fatura semanal (`invoice_kind = weekly_batch`), a que já existia no OS: só leitura das
 * linhas (PDF) e o link do relatório de cada job. Nada aqui ENVIA fatura: dono, 20/10/2026,
 * "não quero que envie fatura semanal; Housekeep e Express já têm processo".
 *
 * Os jobs ficam ligados à fatura por `jobs.invoice_id`; pagou (link, Stripe ou "mark paid"),
 * o valor é repartido entre eles (fatura-semanal-pagamento.ts).
 */

import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job } from "@/types/database";
import { devidoNaFatura, pagamentosDoCliente } from "@/lib/fatura-semanal-pagamento";
import { appBaseUrl } from "@/lib/app-base-url";


const ymdLondres = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const diaCurto = (ymd: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }).format(new Date(`${ymd}T12:00:00Z`));

/** A semana fechada: segunda a domingo antes de `agora` (Londres). */
export function semanaAnterior(agora: Date = new Date()): { inicio: string; fim: string; rotulo: string } {
  const hoje = new Date(`${ymdLondres(agora)}T12:00:00Z`);
  const dow = hoje.getUTCDay(); // 0 = domingo
  const segundaDestaSemana = new Date(hoje.getTime() - ((dow + 6) % 7) * 864e5);
  const inicio = new Date(segundaDestaSemana.getTime() - 7 * 864e5).toISOString().slice(0, 10);
  const fim = new Date(segundaDestaSemana.getTime() - 864e5).toISOString().slice(0, 10);
  return { inicio, fim, rotulo: `${diaCurto(inicio)} to ${diaCurto(fim)}` };
}

/* ------------------------- link público do relatório ------------------------- */

function segredo(): string {
  const s = process.env.QUOTE_RESPONSE_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (!s) {
    if (process.env.NODE_ENV === "production") throw new Error("QUOTE_RESPONSE_SECRET (or NEXTAUTH_SECRET) must be set");
    return "dev-only-insecure-placeholder";
  }
  return s;
}

const assinar = (jobId: string) => createHmac("sha256", segredo()).update(`job-report-view:${jobId}`).digest("base64url");

/** Token do link do relatório para o cliente: o id do job assinado (só leitura, um job). */
export function tokenDoRelatorio(jobId: string): string {
  return `${Buffer.from(jobId, "utf8").toString("base64url")}.${assinar(jobId)}`;
}

export function jobDoTokenDoRelatorio(token: string): string | null {
  const [p, sig] = String(token ?? "").split(".");
  if (!p || !sig) return null;
  let jobId: string;
  try {
    jobId = Buffer.from(p, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  return sig === assinar(jobId) ? jobId : null;
}

export const linkDoRelatorio = (jobId: string) => `${appBaseUrl()}/api/public/job-report/${tokenDoRelatorio(jobId)}`;

/** O report na web, com todas as fotos (/report/[token]); o PDF vira download dentro dele. */
export const linkDoReportWeb = (jobId: string) => `${appBaseUrl()}/report/${tokenDoRelatorio(jobId)}`;

/* ----------------------------- as linhas da fatura ---------------------------- */

export type LinhaDaFaturaSemanal = {
  jobId: string;
  reference: string;
  title: string;
  address: string | null;
  completed: string | null;
  amount: number;
  reportUrl: string;
};

const linha = (j: Job, amount: number): LinhaDaFaturaSemanal => ({
  jobId: j.id,
  reference: String(j.reference ?? ""),
  title: String(j.title ?? "Job"),
  address: (j.property_address as string | null) ?? null,
  completed: (j.completed_date as string | null) ?? null,
  amount,
  reportUrl: linkDoRelatorio(j.id),
});

/** Os jobs de uma fatura semanal já criada, com o valor de cada um (PDF e e-mail). */
export async function linhasDaFaturaSemanal(admin: SupabaseClient, invoiceId: string): Promise<{ linhas: LinhaDaFaturaSemanal[]; jobs: Job[] }> {
  const { data } = await admin.from("jobs").select("*").eq("invoice_id", invoiceId).is("deleted_at", null).order("completed_date", { ascending: true });
  const jobs = (data ?? []) as Job[];
  const pags = await pagamentosDoCliente(admin, jobs.map((j) => j.id));
  return { jobs, linhas: jobs.map((j) => linha(j, devidoNaFatura(j, pags, invoiceId))) };
}

export { repartirPagamentoDaFaturaSemanal, ehFaturaSemanal } from "@/lib/fatura-semanal-pagamento";
