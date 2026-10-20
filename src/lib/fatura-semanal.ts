/**
 * Fatura semanal da conta (dono, 20/10/2026: "cobrar no fim de cada job ou numa data
 * específica"; "Li & Fung no modo semanal").
 *
 * Conta com `weekly_invoice_auto` e termos consolidados ("Every Friday", "Every N days"):
 *  - no final check cada job recebe só o relatório, sem fatura (final-check-automatico.ts);
 *  - toda segunda o cron fecha a semana anterior: UMA fatura (`weekly_batch`) com todos os
 *    jobs concluídos e ainda não faturados, cada job com o link do relatório, enviada pelo
 *    caminho de sempre (Pay now, cópia do financeiro, `sent_at`), e daí os lembretes de
 *    vencida (+1, +3, +4, +7) seguem sozinhos;
 *  - pagou (link, Stripe ou "mark paid"): o valor é repartido entre os jobs da fatura e
 *    cada um fecha pelo caminho de sempre (`finalizeJobAfterInvoicePaid`).
 * Os jobs ficam ligados à fatura por `jobs.invoice_id`, como o lote semanal antigo.
 */

import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job } from "@/types/database";
import { dueDateIsoFromPaymentTerms, isWeeklyConsolidatedTerms } from "@/lib/invoice-payment-terms";
import { devidoNaFatura, pagamentosDoCliente } from "@/lib/fatura-semanal-pagamento";
import { appBaseUrl } from "@/lib/app-base-url";

const EPS = 0.02;

const ymdLondres = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const libras = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

/* ------------------------------- fechar a semana ------------------------------ */

export type ContaSemanal = { id: string; company_name: string | null; payment_terms: string | null };

export type ResultadoDaConta = {
  conta: string;
  jobs: Array<{ reference: string; amount: number }>;
  total: number;
  fatura?: string;
  enviada?: boolean;
  erro?: string;
};

/**
 * Fecha a semana de uma conta: jobs em Awaiting payment sem fatura, concluídos até o
 * domingo, viram uma fatura só. `aplicar: false` só lista.
 */
export async function fecharFaturaSemanal(
  admin: SupabaseClient,
  conta: ContaSemanal,
  opts: { aplicar: boolean; agora?: Date },
): Promise<ResultadoDaConta> {
  const nome = conta.company_name?.trim() || "Account";
  const r: ResultadoDaConta = { conta: nome, jobs: [], total: 0 };
  if (!isWeeklyConsolidatedTerms(conta.payment_terms)) {
    r.erro = `payment terms "${conta.payment_terms ?? ""}" are not weekly`;
    return r;
  }
  const semana = semanaAnterior(opts.agora);

  const { data: clientes } = await admin.from("clients").select("id").eq("source_account_id", conta.id);
  const idsClientes = (clientes ?? []).map((c) => (c as { id: string }).id);
  if (!idsClientes.length) return r;

  const { data: brutos } = await admin
    .from("jobs")
    .select("*")
    .in("client_id", idsClientes)
    .eq("status", "awaiting_payment")
    .is("deleted_at", null)
    .lte("completed_date", semana.fim)
    .order("completed_date", { ascending: true });
  /**
   * Sem fatura, com um rascunho que nunca saiu (a fatura que o job ganha ao nascer, ou o lote
   * antigo da tela) ou ligado a uma fatura cancelada: o job entra no lote e o rascunho é
   * cancelado. Fatura enviada ou com pagamento fica onde está.
   */
  const comFatura = ((brutos ?? []) as Job[]).filter((j) => j.invoice_id);
  const rascunhos = new Set<string>();
  if (comFatura.length) {
    const { data: fats } = await admin.from("invoices").select("id, status, sent_at, amount_paid").in("id", comFatura.map((j) => j.invoice_id as string));
    for (const f of (fats ?? []) as Array<{ id: string; status: string; sent_at: string | null; amount_paid: number | null }>) {
      const semPagamento = Number(f.amount_paid ?? 0) <= EPS;
      if ((f.status === "draft" && !f.sent_at && semPagamento) || f.status === "cancelled") rascunhos.add(f.id);
    }
  }
  const candidatos = ((brutos ?? []) as Job[]).filter((j) => !j.invoice_id || rascunhos.has(j.invoice_id));
  const pags = await pagamentosDoCliente(admin, candidatos.map((j) => j.id));
  const devidos = candidatos.map((j) => ({ j, valor: devidoNaFatura(j, pags, null) })).filter((x) => x.valor > EPS);
  r.jobs = devidos.map((x) => ({ reference: String(x.j.reference ?? ""), amount: x.valor }));
  r.total = Math.round(devidos.reduce((s, x) => s + x.valor, 0) * 100) / 100;
  if (!devidos.length || !opts.aplicar) return r;

  // Uma fatura por conta e semana: rodar de novo não duplica.
  const { data: jaExiste } = await admin
    .from("invoices")
    .select("id, reference")
    .eq("source_account_id", conta.id)
    .eq("billing_week_start", semana.inicio)
    .eq("invoice_kind", "weekly_batch")
    .is("deleted_at", null)
    .maybeSingle();
  if (jaExiste) {
    r.erro = `${(jaExiste as { reference: string }).reference} already exists for the week of ${semana.inicio}`;
    return r;
  }

  const { data: ref } = await admin.rpc("next_invoice_ref");
  const reference = (ref as string) ?? `INV-${Date.now()}`;
  const due = dueDateIsoFromPaymentTerms(new Date(), conta.payment_terms);
  const primeiro = devidos[0].j;
  const { data: inv, error } = await admin
    .from("invoices")
    .insert({
      reference,
      client_name: nome,
      job_reference: primeiro.reference,
      amount: r.total,
      status: "pending",
      due_date: due,
      invoice_kind: "weekly_batch",
      billing_week_start: semana.inicio,
      source_account_id: conta.id,
      collection_stage: "awaiting_final",
      collection_stage_locked: false,
    })
    .select("id, reference")
    .single();
  if (error || !inv) {
    r.erro = `invoice not created: ${error?.message ?? "unknown"}`;
    return r;
  }
  const faturaId = (inv as { id: string }).id;
  r.fatura = (inv as { reference: string }).reference;

  const rascunhosDoLote = [...new Set(devidos.map((x) => x.j.invoice_id).filter((id): id is string => !!id && rascunhos.has(id)))];
  if (rascunhosDoLote.length) {
    await admin.from("invoices").update({ status: "cancelled", cancellation_reason: `Replaced by the weekly invoice ${r.fatura}` }).in("id", rascunhosDoLote).eq("status", "draft");
  }
  const { error: errJobs } = await admin.from("jobs").update({ invoice_id: faturaId }).in("id", devidos.map((x) => x.j.id));
  if (errJobs) {
    r.erro = `jobs not linked: ${errJobs.message}`;
    return r;
  }

  const { sendInvoiceEmail } = await import("@/lib/invoice-send-email");
  const linhas = devidos.map((x) => linha(x.j, x.valor));
  const envio = await sendInvoiceEmail(admin, faturaId, {
    userId: null,
    userName: "Weekly invoice (automatic)",
    jobId: primeiro.id,
    semanal: { assunto: `Your weekly invoice ${reference} · ${linhas.length} job${linhas.length === 1 ? "" : "s"} · ${semana.rotulo}`, html: emailDaFaturaSemanal({ conta: nome, reference, rotulo: semana.rotulo, total: r.total, due, linhas }) },
  });
  r.enviada = !("error" in envio);
  if ("error" in envio) r.erro = `not sent: ${envio.error}`;
  return r;
}

/* ------------------------------------ e-mail ----------------------------------- */

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function emailDaFaturaSemanal(a: { conta: string; reference: string; rotulo: string; total: number; due: string; linhas: LinhaDaFaturaSemanal[] }): string {
  const pay = `${appBaseUrl()}/pay/${encodeURIComponent(a.reference)}`;
  const vence = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" }).format(new Date(`${a.due}T12:00:00Z`));
  const td = "padding:8px 6px;border-bottom:1px solid #EEEEF3;font-size:13px;color:#1C1B2E;vertical-align:top;";
  const linhas = a.linhas
    .map(
      (l) =>
        `<tr><td style="${td}"><strong>${esc(l.reference)}</strong><br><span style="color:#5B5B6E;">${esc(l.title)}${l.address ? ` · ${esc(l.address)}` : ""}${l.completed ? `<br>Completed ${esc(diaCurto(l.completed))}` : ""}</span></td>` +
        `<td style="${td}"><a href="${esc(l.reportUrl)}" style="color:#020040;">Report</a></td>` +
        `<td style="${td}text-align:right;white-space:nowrap;">${libras(l.amount)}</td></tr>`,
    )
    .join("");
  return `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:620px;margin:0 auto;color:#1C1B2E;">
<p style="font-size:15px;line-height:22px;">Hi ${esc(a.conta)} team,</p>
<p style="font-size:15px;line-height:22px;">Here is your weekly invoice for the work we completed ${esc(a.rotulo)}: ${a.linhas.length} job${a.linhas.length === 1 ? "" : "s"}, ${libras(a.total)} in total, due ${esc(vence)}. The invoice PDF is attached and each job has its report below.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:12px 0;">
<tr><th align="left" style="padding:6px;font-size:11px;color:#6B6E7B;text-transform:uppercase;">Job</th><th align="left" style="padding:6px;font-size:11px;color:#6B6E7B;text-transform:uppercase;">Report</th><th align="right" style="padding:6px;font-size:11px;color:#6B6E7B;text-transform:uppercase;">Amount</th></tr>
${linhas}
<tr><td colspan="2" style="padding:10px 6px;font-size:14px;font-weight:700;">Total</td><td style="padding:10px 6px;font-size:14px;font-weight:700;text-align:right;">${libras(a.total)}</td></tr>
</table>
<p style="text-align:center;margin:20px 0;"><a href="${esc(pay)}" style="display:inline-block;padding:13px 26px;background:#020040;color:#FFFFFF;font-size:14px;font-weight:700;text-decoration:none;border-radius:8px;">Pay ${libras(a.total)} now</a></p>
<p style="font-size:13px;line-height:20px;color:#5B5B6E;">You can also pay by bank transfer using the details on the invoice, with ${esc(a.reference)} as the reference. Any questions, just reply to this email.</p>
<p style="font-size:15px;line-height:22px;">Kind regards,<br>Fixfy Team</p>
</div>`;
}

export { repartirPagamentoDaFaturaSemanal, ehFaturaSemanal } from "@/lib/fatura-semanal-pagamento";
