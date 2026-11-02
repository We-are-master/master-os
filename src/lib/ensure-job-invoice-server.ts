import "server-only";
/**
 * Fatura do job e cobrança na criação, do lado do servidor (15/10/2026).
 *
 * A tela cria a fatura no navegador (`createJob` → `createInvoice`, que usam o
 * `getSupabase` do browser). `POST /api/jobs` não tinha equivalente, então job
 * de agente, script ou macro do Zendesk nascia sem fatura e sem como cobrar.
 * Aqui é a mesma regra com o cliente de serviço: referência do `next_invoice_ref`,
 * conta herdada do cliente, vencimento pelos termos da conta, /pay/<ref> e o
 * `syncJobAfterInvoiceCreated` de sempre (liga `jobs.invoice_id` e acerta o estágio).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveNominalBillingParty } from "@/lib/account-billing-addressee";
import { orgCtxFromSetup } from "@/lib/account-payment-due-date";
import { parseFrontendSetup } from "@/lib/frontend-setup";
import { sendInvoiceEmail } from "@/lib/invoice-send-email";
import { resolveJobCompletionInstant } from "@/lib/job-completion-anchor";
import { dueDateIsoForJobAccountTerms } from "@/lib/job-invoice-due-anchor";
import { buildJobInvoiceRow, jobInvoiceTotal, weeklyInvoiceSkipReason } from "@/lib/job-invoice-row";
import { invoicePayLinkUrl } from "@/lib/pay-link-url";
import { syncJobAfterInvoiceCreated } from "@/lib/sync-invoices-from-job-payments";
import type { Invoice, Job } from "@/types/database";

type FaturaDoJob = Pick<Invoice, "id" | "reference" | "amount" | "status">;

export type EnsureJobInvoiceResult =
  | { ok: true; invoice: FaturaDoJob; created: boolean }
  | { ok: false; reason: string };

const CAMPOS_FATURA = "id, reference, amount, status";

export async function ensureJobInvoiceServer(admin: SupabaseClient, jobId: string): Promise<EnsureJobInvoiceResult> {
  const { data: jobRow, error: jobErr } = await admin.from("jobs").select("*").eq("id", jobId).is("deleted_at", null).maybeSingle();
  if (jobErr || !jobRow) return { ok: false, reason: "Job not found: no invoice was created." };
  const job = jobRow as Job;

  // Já tem: a primária do job, senão a mais antiga ligada pela referência.
  if (job.invoice_id?.trim()) {
    const { data } = await admin.from("invoices").select(CAMPOS_FATURA).eq("id", job.invoice_id).is("deleted_at", null).maybeSingle();
    const inv = data as FaturaDoJob | null;
    if (inv && inv.status !== "cancelled") return { ok: true, invoice: inv, created: false };
  }
  const { data: porRef } = await admin
    .from("invoices")
    .select(CAMPOS_FATURA)
    .eq("job_reference", job.reference)
    .is("deleted_at", null)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (porRef) {
    const inv = porRef as FaturaDoJob;
    if (!job.invoice_id?.trim()) await admin.from("jobs").update({ invoice_id: inv.id }).eq("id", job.id);
    return { ok: true, invoice: inv, created: false };
  }

  const billing = await resolveNominalBillingParty(admin, {
    clientId: job.client_id?.trim() ?? "",
    fallbackName: job.client_name,
    fallbackEmail: null,
  }).catch(() => ({ displayName: job.client_name, sourceAccountId: null as string | null }));
  const accountId = billing.sourceAccountId?.trim() || null;

  let paymentTerms: string | null = null;
  if (accountId) {
    const { data: acc } = await admin.from("accounts").select("company_name, payment_terms").eq("id", accountId).maybeSingle();
    const a = acc as { company_name?: string | null; payment_terms?: string | null } | null;
    paymentTerms = a?.payment_terms?.trim() || null;
    const semanal = weeklyInvoiceSkipReason(paymentTerms, a?.company_name);
    if (semanal) return { ok: false, reason: semanal };
  }

  // Vencimento: mesma regra do `getInvoiceDueDateIsoForClient`, com o cliente de serviço.
  const { data: company } = await admin.from("company_settings").select("frontend_setup").limit(1).maybeSingle();
  const orgCtx = orgCtxFromSetup(parseFrontendSetup((company as { frontend_setup?: unknown } | null)?.frontend_setup));
  const completion = resolveJobCompletionInstant(job);
  const dueDate = dueDateIsoForJobAccountTerms(completion ?? new Date(), paymentTerms, orgCtx, {
    jobKind: job.job_kind ?? "one_off",
    scheduleAnchor: completion,
  });

  const { data: refData, error: refErr } = await admin.rpc("next_invoice_ref");
  const reference = typeof refData === "string" ? refData.trim() : "";
  if (refErr || !reference) return { ok: false, reason: `Could not generate the invoice reference: ${refErr?.message ?? "empty"}.` };

  const row = buildJobInvoiceRow({
    reference,
    jobReference: job.reference,
    clientName: billing.displayName,
    amount: jobInvoiceTotal(job),
    dueDate,
    sourceAccountId: accountId,
  });
  const { data: inserted, error: insErr } = await admin.from("invoices").insert(row).select("*").single();
  if (insErr || !inserted) return { ok: false, reason: `Could not create the invoice: ${insErr?.message ?? "unknown error"}.` };
  const inv = inserted as Invoice;

  // Esperado, não `void`: na Vercel a função morre depois da resposta.
  try {
    await syncJobAfterInvoiceCreated(admin, inv);
  } catch (e) {
    console.error("[ensure-job-invoice] syncJobAfterInvoiceCreated", inv.id, e);
    await admin.from("jobs").update({ invoice_id: inv.id }).eq("id", job.id).is("invoice_id", null);
  }
  return { ok: true, invoice: { id: inv.id, reference: inv.reference, amount: inv.amount, status: inv.status }, created: true };
}

/** O que `POST /api/jobs` devolve em `charge_on_create`. */
export type ChargeOnCreateResult = {
  sent: boolean;
  percent: number;
  /** "requested": quem chamou pediu; "account_default": a conta é Card upfront e o pedido veio vazio. */
  source?: "requested" | "account_default";
  to?: string;
  pay_url?: string;
  invoice_reference?: string;
  reason?: string;
};

/** Quem aparece no histórico da fatura quando a cobrança sai pela API. */
export const API_CHARGE_ACTOR = "Master OS API (create job)";

/**
 * Cobrança na criação para job que nasceu pela API: garante a fatura e manda o
 * mesmo e-mail de "almost there" do modal (`variant: "booking"`). Quem decide SE
 * cobra é `decideApiChargeOnCreate` (conta, plataforma, já pago); aqui só executa.
 * Nunca lança: o job já existe, e quem chamou recebe o motivo quando não sai.
 */
export async function chargeJobOnCreateServer(
  admin: SupabaseClient,
  opts: { jobId: string; percent: number; source?: "requested" | "account_default"; actorName?: string },
): Promise<ChargeOnCreateResult> {
  const percent = opts.percent;
  const source = opts.source;
  try {
    const ensured = await ensureJobInvoiceServer(admin, opts.jobId);
    if (!ensured.ok) return { sent: false, percent, source, reason: ensured.reason };
    const inv = ensured.invoice;
    const payUrl = invoicePayLinkUrl(inv.reference, percent < 100 ? percent : undefined);
    const base = { percent, source, pay_url: payUrl, invoice_reference: inv.reference };
    if (!(Number(inv.amount) > 0.02)) {
      return { ...base, sent: false, reason: "The job has no customer price yet (hourly jobs are priced at the end): no payment request was sent." };
    }

    const r = await sendInvoiceEmail(admin, inv.id, {
      userId: null,
      userName: opts.actorName?.trim() || API_CHARGE_ACTOR,
      requestPercent: percent >= 100 ? undefined : percent,
      jobId: opts.jobId,
      variant: "booking",
    });
    if ("error" in r) return { ...base, sent: false, reason: r.error };
    return { ...base, sent: true, to: r.to };
  } catch (e) {
    console.error("[charge-on-create api]", opts.jobId, e);
    return { sent: false, percent, source, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Job com preço e sem fatura não pode existir (dono, 02/11/2026: "todo job que colocar
 * preço depois tem que criar fatura na hora do preço"). Job por hora com £0 mas com taxa
 * e horas lançadas ganha o preço das horas antes (era o que travava o Final review do
 * JOB-9799 e do JOB-9807). Cria em rascunho: nada vai ao cliente daqui.
 */
export async function garantirFaturaDoJob(
  admin: SupabaseClient,
  jobId: string,
): Promise<EnsureJobInvoiceResult | { ok: false; reason: "sem_preco" | "fora" }> {
  const { data } = await admin
    .from("jobs")
    .select("id, status, job_type, client_price, partner_cost, billed_hours, hourly_client_rate, hourly_partner_rate, extras_amount, promotion_amount, invoice_id")
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  const j = data as (Pick<Job, "id" | "status" | "job_type" | "client_price" | "partner_cost" | "billed_hours" | "hourly_client_rate" | "hourly_partner_rate" | "extras_amount" | "invoice_id"> & { promotion_amount?: number | null }) | null;
  if (!j || j.status === "cancelled" || j.status === "deleted") return { ok: false, reason: "fora" };
  if (j.job_type === "hourly" && !(Number(j.client_price) > 0.02)) {
    const h = Number(j.billed_hours) || 0;
    const preco = Math.round(h * (Number(j.hourly_client_rate) || 0) * 100) / 100;
    if (preco > 0.02) {
      const custo = Math.round(h * (Number(j.hourly_partner_rate) || 0) * 100) / 100;
      await admin
        .from("jobs")
        .update({ client_price: preco, ...(Number(j.partner_cost) > 0.02 ? {} : { partner_cost: custo }) })
        .eq("id", j.id);
      j.client_price = preco;
    }
  }
  const total = (Number(j.client_price) || 0) + (Number(j.extras_amount) || 0) - (Number(j.promotion_amount) || 0);
  if (!(total > 0.02)) return { ok: false, reason: "sem_preco" };
  return ensureJobInvoiceServer(admin, j.id);
}

/** Varredura: jobs vivos com preço (ou por hora com horas) e sem fatura. */
export async function garantirFaturasQueFaltam(admin: SupabaseClient, limite = 50) {
  const { data } = await admin
    .from("jobs")
    .select("id, reference")
    .is("invoice_id", null)
    .is("deleted_at", null)
    .not("status", "in", "(cancelled,deleted)")
    .or("client_price.gt.0,and(job_type.eq.hourly,billed_hours.gt.0,hourly_client_rate.gt.0)")
    .order("created_at", { ascending: false })
    .limit(limite);
  const resultados: { reference: string | null; ok: boolean; motivo?: string; fatura?: string }[] = [];
  for (const j of (data ?? []) as { id: string; reference: string | null }[]) {
    const r = await garantirFaturaDoJob(admin, j.id).catch((e) => ({ ok: false as const, reason: e instanceof Error ? e.message : String(e) }));
    resultados.push(r.ok ? { reference: j.reference, ok: true, fatura: r.invoice.reference } : { reference: j.reference, ok: false, motivo: r.reason });
  }
  return resultados;
}
