import "server-only";
/**
 * Final check automático (Fase 3, dono 15/10/2026).
 *
 * O parceiro manda o relatório e o job cai em Final Checks (`report-submission.ts`). Aqui
 * o sistema faz o que a pessoa faz no "Finish work" (`handleValidateAndComplete` em
 * job-detail-client.tsx): aprova o relatório, cobra o cartão salvo quando a conta paga no
 * cartão, garante a fatura do job com o vencimento do fim da obra, move o job para
 * Awaiting payment e manda o e-mail final da conta (relatório + fatura com o Pay now do
 * saldo). Pago = o job fecha (`finalizeJobAfterInvoicePaid`); não pago = a fatura vence e
 * entra nos lembretes de 1, 3, 4 e 7 dias.
 *
 * O que pede olho humano fica em Final Checks com uma nota interna no ticket dizendo por
 * quê (`decidirFinalCheck`). Tudo atrás de FINAL_CHECK_AUTO=1; desligado, nada muda.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountFinalEmailPolicyFromRow } from "@/lib/account-final-email-policy";
import { resolveNominalBillingParty } from "@/lib/account-billing-addressee";
import { orgCtxFromSetup } from "@/lib/account-payment-due-date";
import { ensureJobInvoiceServer } from "@/lib/ensure-job-invoice-server";
import { decidirFinalCheck, type DecisaoFinalCheck } from "@/lib/final-check-decisao";
import { sendFinalReviewEmail } from "@/lib/final-review-email";
import { parseFrontendSetup } from "@/lib/frontend-setup";
import { resolveJobCompletionInstant } from "@/lib/job-completion-anchor";
import { jobCustomerBillableRevenueForCollections } from "@/lib/job-financials";
import { dueDateIsoForJobAccountTerms } from "@/lib/job-invoice-due-anchor";
import { weeklyInvoiceSkipReason } from "@/lib/job-invoice-row";
import { buildJobReviewApprovalPatch, reportCompletionGate } from "@/lib/job-phases";
import { normalizeReport } from "@/lib/job-report-v2";
import { statusChangeOfficeTimerPatch } from "@/lib/office-job-timer";
import { statusChangePartnerTimerPatch } from "@/lib/partner-live-timer";
import { parseMaterialExtra } from "@/lib/report-material-extra";
import { chargeJobBalanceOnSavedCard } from "@/lib/stripe-card-charge";
import { parsePostgrestUnknownColumnName } from "@/lib/supabase-schema-compat";
import { finalizeJobAfterInvoicePaid } from "@/lib/sync-job-after-invoice-paid";
import { syncInvoicesFromJobCustomerPayments } from "@/lib/sync-invoices-from-job-payments";
import { syncJobFinanceServer } from "@/lib/sync-job-finance-server";
import { getZendeskTicketId, isZendeskConfigured, zendeskApi } from "@/lib/zendesk";
import { syncJobZendeskStatus } from "@/lib/zendesk-status-sync";
import { ZD_STATUS_COMPLAINT } from "@/lib/zendesk-statuses";
import type { Account, Invoice, Job } from "@/types/database";

export const FINAL_CHECK_AUTO_ON = () => process.env.FINAL_CHECK_AUTO?.trim() === "1";

const EPS = 0.02;
/** Marca no histórico do job: uma linha por decisão automática. */
const CAMPO_AUDIT = "final_check_auto";

export type OrigemFinalCheck = "report_submitted" | "sweep";

export type ResultadoFinalCheck =
  | { feito: "desligado" }
  | { feito: "ignorado"; motivo: string }
  | { feito: "equipe"; codigo: string; motivo: string; notaNoTicket: boolean }
  | { feito: "ensaio"; decisao: DecisaoFinalCheck }
  | {
      feito: "aprovado";
      status: string;
      saldo: number;
      vencimento: string | null;
      email: { ok: true; canal: string } | { ok: false; erro: string };
      cartao?: string;
    }
  | { feito: "erro"; erro: string };

const dataLondres = (iso: string | null | undefined): string => {
  if (!iso) return "?";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "?";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
};

async function notaInterna(job: Job, corpo: string): Promise<boolean> {
  const ticketId = getZendeskTicketId(job);
  if (!ticketId || !isZendeskConfigured()) return false;
  try {
    await zendeskApi(`tickets/${ticketId}.json`, { method: "PUT", body: { ticket: { comment: { public: false, body: corpo } } } });
    return true;
  } catch (e) {
    console.error("[final-check-auto] nota no ticket falhou", job.reference, e);
    return false;
  }
}

async function registrar(admin: SupabaseClient, job: Job, novo: string, metadata: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("audit_logs").insert({
    entity_type: "job",
    entity_id: job.id,
    entity_ref: job.reference ?? null,
    // `action` tem vocabulário fixo no banco: o evento vai em metadata.
    action: "updated",
    field_name: CAMPO_AUDIT,
    old_value: job.status ?? null,
    new_value: novo,
    metadata: { event: "final_check_auto", ...metadata },
  });
  if (error) console.error("[final-check-auto] audit_logs", job.reference, error.message);
}

/** Já deixamos este job para a equipe por este mesmo motivo? A varredura não repete a nota. */
async function jaAvisado(admin: SupabaseClient, jobId: string, novo: string): Promise<boolean> {
  const { count, error } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("entity_type", "job")
    .eq("entity_id", jobId)
    .eq("field_name", CAMPO_AUDIT)
    .eq("new_value", novo);
  return !error && (count ?? 0) > 0;
}

/** Reclamação no ticket do job: status Complaint ou tag `com_leo` / `complaint`. Sem Zendesk = não sabe = false. */
async function ticketEmReclamacao(job: Job): Promise<boolean> {
  const ticketId = getZendeskTicketId(job);
  if (!ticketId || !isZendeskConfigured()) return false;
  const r = await zendeskApi<{ ticket?: { custom_status_id?: number | null; tags?: string[] } }>(`tickets/${ticketId}.json`);
  const t = r.ticket;
  if (!t) return false;
  if (Number(t.custom_status_id) === ZD_STATUS_COMPLAINT) return true;
  return (t.tags ?? []).some((tag) => tag === "com_leo" || tag === "complaint");
}

type Faturas = { linhas: Invoice[]; total: number | null; semanal: boolean };

async function faturasDoJob(admin: SupabaseClient, job: Job): Promise<Faturas> {
  const { data } = await admin.from("invoices").select("*").eq("job_reference", job.reference).is("deleted_at", null);
  const linhas = [...((data ?? []) as Invoice[])];
  if (job.invoice_id && !linhas.some((i) => i.id === job.invoice_id)) {
    const { data: p } = await admin.from("invoices").select("*").eq("id", job.invoice_id).is("deleted_at", null).maybeSingle();
    if (p) linhas.unshift(p as Invoice);
  }
  const vivas = linhas.filter((i) => i.status !== "cancelled");
  const semanal = vivas.some((i) => i.invoice_kind === "weekly_batch");
  const contam = vivas.filter((i) => i.invoice_kind !== "weekly_batch");
  const total = contam.length ? Math.round(contam.reduce((s, i) => s + Number(i.amount ?? 0), 0) * 100) / 100 : null;
  return { linhas: contam, total, semanal };
}

async function pagoPeloCliente(admin: SupabaseClient, jobId: string): Promise<number> {
  const { data } = await admin.from("job_payments").select("*").eq("job_id", jobId);
  const soma = ((data ?? []) as { type: string; amount: number; deleted_at?: string | null }[])
    .filter((p) => !p.deleted_at && (p.type === "customer_deposit" || p.type === "customer_final"))
    .reduce((s, p) => s + Number(p.amount || 0), 0);
  return Math.round(soma * 100) / 100;
}

async function carregarJob(admin: SupabaseClient, jobId: string): Promise<Job | null> {
  const { data } = await admin.from("jobs").select("*").eq("id", jobId).is("deleted_at", null).maybeSingle();
  return (data as Job | null) ?? null;
}

/** Update do job tolerante a coluna que não existe no banco (o mesmo que o `updateJob` da tela faz). */
async function atualizarJobDeFinalCheck(admin: SupabaseClient, jobId: string, patch: Record<string, unknown>): Promise<boolean> {
  let corpo = { ...patch };
  for (let i = 0; i < 12; i++) {
    const { data, error } = await admin.from("jobs").update(corpo).eq("id", jobId).eq("status", "final_check").select("id");
    if (!error) return (data ?? []).length > 0;
    const col = parsePostgrestUnknownColumnName(error);
    if (col && col in corpo && col !== "status") {
      delete corpo[col];
      corpo = { ...corpo };
      continue;
    }
    throw new Error(error.message);
  }
  return false;
}

/**
 * Roda o final check automático de um job. Nunca lança: quem chama (rota do relatório,
 * varredura) só registra o resultado. `ensaio` decide sem gravar nada, mesmo com a chave
 * desligada.
 */
export async function runFinalCheckAutomatico(
  admin: SupabaseClient,
  jobId: string,
  opts: { origem: OrigemFinalCheck; ensaio?: boolean },
): Promise<ResultadoFinalCheck> {
  if (!opts.ensaio && !FINAL_CHECK_AUTO_ON()) return { feito: "desligado" };
  try {
    return await executar(admin, jobId, opts);
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    console.error("[final-check-auto]", jobId, erro);
    return { feito: "erro", erro };
  }
}

async function executar(
  admin: SupabaseClient,
  jobId: string,
  opts: { origem: OrigemFinalCheck; ensaio?: boolean },
): Promise<ResultadoFinalCheck> {
  const job = await carregarJob(admin, jobId);
  if (!job) return { feito: "ignorado", motivo: "job not found" };
  // Barato primeiro: fora de final check não lê mais nada.
  if (job.status !== "final_check") return { feito: "ignorado", motivo: `status ${job.status}` };
  if (job.review_sent_at) return { feito: "ignorado", motivo: "final email already sent" };
  if (!job.final_report_submitted) return { feito: "ignorado", motivo: "no final report" };

  const billing = job.client_id?.trim()
    ? await resolveNominalBillingParty(admin, { clientId: job.client_id.trim(), fallbackName: job.client_name ?? "Client", fallbackEmail: null })
    : null;
  const contaId = billing?.sourceAccountId?.trim() || null;
  const conta = contaId
    ? ((await admin.from("accounts").select("*").eq("id", contaId).is("deleted_at", null).maybeSingle()).data as Account | null)
    : null;
  const politica = accountFinalEmailPolicyFromRow(conta);
  const termos = (conta as { payment_terms?: string | null } | null)?.payment_terms?.trim() || null;

  const [faturas, pago, reclamacao] = await Promise.all([
    faturasDoJob(admin, job),
    pagoPeloCliente(admin, job.id),
    ticketEmReclamacao(job).catch((e): null => {
      console.error("[final-check-auto] leitura do ticket falhou", job.reference, e);
      return null;
    }),
  ]);
  const relatorio = normalizeReport(job.final_report);

  const decisao = decidirFinalCheck({
    status: job.status,
    reviewSentAt: job.review_sent_at,
    finalReportSubmitted: job.final_report_submitted,
    jobType: job.job_type,
    platformReport: Boolean((job as { report_link?: string | null }).report_link?.trim()),
    reportFields: relatorio?.fields ?? null,
    reportGate: reportCompletionGate(job),
    materialExtraCharge: parseMaterialExtra(relatorio?.fields ?? null).charge,
    complaint: reclamacao === true,
    complaintUnknown: reclamacao === null,
    jobTotal: jobCustomerBillableRevenueForCollections(job),
    invoicesTotal: faturas.total,
    customerPaid: pago,
    weeklyInvoice: faturas.semanal || Boolean(weeklyInvoiceSkipReason(termos, conta?.company_name)),
    emailPolicy: politica,
    billingEmail: billing?.documentEmail ?? null,
  });

  if (opts.ensaio) return { feito: "ensaio", decisao };
  if (decisao.acao === "ignorar") return { feito: "ignorado", motivo: decisao.motivo };

  const enviado = dataLondres((job.final_report as { submitted_at?: string } | null)?.submitted_at ?? null);
  if (decisao.acao === "equipe") {
    const marca = `held:${decisao.codigo}`;
    if (await jaAvisado(admin, job.id, marca)) {
      return { feito: "equipe", codigo: decisao.codigo, motivo: decisao.motivo, notaNoTicket: false };
    }
    const nota = await notaInterna(
      job,
      `Final check left for the team: ${decisao.motivo}. Report submitted ${enviado}. Review the job and use Finish work when it is right.`,
    );
    await registrar(admin, job, marca, { origem: opts.origem, motivo: decisao.motivo, nota_no_ticket: nota });
    return { feito: "equipe", codigo: decisao.codigo, motivo: decisao.motivo, notaNoTicket: nota };
  }

  return aprovar(admin, job, { origem: opts.origem, termos, enviado, politica });
}

async function aprovar(
  admin: SupabaseClient,
  job: Job,
  ctx: { origem: OrigemFinalCheck; termos: string | null; enviado: string; politica: { canIncludeInvoice: boolean; canIncludeReport: boolean } },
): Promise<ResultadoFinalCheck> {
  // 1. Cartão salvo (conta que paga no cartão): cobra o restante ANTES de sair de final check,
  //    como o modal. Recusado segue para Awaiting payment com o chip "Card declined".
  let cartao: string | undefined;
  const j = job as Job & { stripe_payment_method_id?: string | null; card_charge_status?: string | null; card_charge_hold?: boolean | null };
  if (j.stripe_payment_method_id && j.card_charge_status !== "charged" && !j.card_charge_hold) {
    const r = await chargeJobBalanceOnSavedCard(admin, job.id, { actorId: null });
    if (r.status === "charged") cartao = `£${r.amountGbp.toFixed(2)} charged to the saved card`;
    else if (r.status === "refused" || r.status === "requires_action") {
      cartao = `card declined for £${r.amountGbp.toFixed(2)} (${r.reason})`;
      const quando =
        r.status === "refused" && r.retryAt
          ? `Next automatic try: ${dataLondres(r.retryAt)}.`
          : "No automatic retry for this decline: the customer needs to pay by link.";
      await notaInterna(
        job,
        `💳 Card declined for the £${r.amountGbp.toFixed(2)} balance: ${r.reason}. The job moves to Awaiting payment marked "Card declined". ${quando} If the customer pays another way, record the payment on the job (bank transfer, cash...) and it closes.`,
      );
    }
  }

  // 2. Fatura do job (cria se faltar) com o vencimento pelo fim da obra e os termos da conta.
  const fatura = await ensureJobInvoiceServer(admin, job.id);
  if (!fatura.ok) {
    const motivo = `could not prepare the invoice (${fatura.reason})`;
    const nota = await notaInterna(job, `Final check left for the team: ${motivo}. Report submitted ${ctx.enviado}.`);
    await registrar(admin, job, "held:invoice", { origem: ctx.origem, motivo, nota_no_ticket: nota });
    return { feito: "equipe", codigo: "invoice", motivo, notaNoTicket: nota };
  }
  const { data: setup } = await admin.from("company_settings").select("frontend_setup").limit(1).maybeSingle();
  const orgCtx = orgCtxFromSetup(parseFrontendSetup((setup as { frontend_setup?: unknown } | null)?.frontend_setup));
  const conclusao = resolveJobCompletionInstant(job);
  const vencimento = dueDateIsoForJobAccountTerms(conclusao ?? new Date(), ctx.termos, orgCtx, {
    jobKind: job.job_kind ?? "one_off",
    scheduleAnchor: conclusao,
  });
  const { data: invRow } = await admin.from("invoices").select("*").eq("id", fatura.invoice.id).maybeSingle();
  const inv = invRow as (Invoice & { collection_stage_locked?: boolean | null }) | null;
  if (inv) {
    const patch: Record<string, unknown> = { due_date: vencimento };
    // Draft vira cobrança (o "pending" do modal); paga/parcial o sync de pagamentos acerta abaixo.
    if (inv.status === "draft") patch.status = "pending";
    if (!inv.collection_stage_locked && inv.status !== "paid") patch.collection_stage = "awaiting_final";
    const { error } = await admin.from("invoices").update(patch).eq("id", inv.id);
    if (error) console.error("[final-check-auto] fatura", inv.reference, error.message);
  }
  await syncInvoicesFromJobCustomerPayments(admin, job.id);

  // 3. Aprova o relatório e move para Awaiting payment (só se ainda estiver em final check:
  //    se alguém aprovou na mão no meio do caminho, para aqui).
  const atual = (await carregarJob(admin, job.id)) ?? job;
  const patch: Record<string, unknown> = {
    ...buildJobReviewApprovalPatch({ submittedAt: atual.report_1_approved_at ?? undefined }),
    status: "awaiting_payment",
    ...statusChangePartnerTimerPatch(atual, "awaiting_payment"),
    ...statusChangeOfficeTimerPatch(atual, "awaiting_payment"),
    ...(atual.invoice_id !== fatura.invoice.id && !atual.invoice_id ? { invoice_id: fatura.invoice.id } : {}),
    ...(atual.completed_date?.trim() ? {} : { completed_date: new Date().toISOString().slice(0, 10) }),
    updated_at: new Date().toISOString(),
  };
  const moveu = await atualizarJobDeFinalCheck(admin, job.id, patch);
  if (!moveu) return { feito: "ignorado", motivo: "job left final check before approval (someone finished it by hand)" };
  await admin.from("audit_logs").insert({
    entity_type: "job",
    entity_id: job.id,
    entity_ref: job.reference ?? null,
    action: "status_changed",
    field_name: "status",
    old_value: "final_check",
    new_value: "awaiting_payment",
    user_name: "Final check (automatic)",
  });

  // 4. Self-bill e pagamento: totais do parceiro e, se o cliente já pagou tudo, fecha o job.
  try {
    await syncJobFinanceServer(admin, job.id);
  } catch (e) {
    console.error("[final-check-auto] sync-finance", job.reference, e);
  }
  await finalizeJobAfterInvoicePaid(admin, job.id);
  const depois = (await carregarJob(admin, job.id)) ?? atual;
  const pago = await pagoPeloCliente(admin, job.id);
  const saldo = Math.max(0, Math.round((jobCustomerBillableRevenueForCollections(depois) - pago) * 100) / 100);

  // 5. E-mail final, com o que a conta permite (o padrão do modal).
  const r = await sendFinalReviewEmail(admin, job.id, {
    includeInvoice: ctx.politica.canIncludeInvoice,
    includeReport: ctx.politica.canIncludeReport,
    source: "final_check_auto",
  });
  const email: { ok: true; canal: string } | { ok: false; erro: string } = r.ok ? { ok: true, canal: r.channel === "zendesk" ? "Zendesk ticket" : "email" } : { ok: false, erro: r.error };

  // 6. Status do ticket acompanha o job (o gatilho do banco também faz; repetir é seguro).
  try {
    await syncJobZendeskStatus(job.id, admin);
  } catch (e) {
    console.error("[final-check-auto] status do ticket", job.reference, e);
  }

  const partes = [`Final check approved automatically: report submitted ${ctx.enviado}`];
  partes.push(email.ok ? `final email sent (${email.canal})` : `final email NOT sent (${email.erro}), send it from the job`);
  if (cartao) partes.push(cartao);
  partes.push(
    saldo > EPS
      ? `balance £${saldo.toFixed(2)} due ${dataLondres(vencimento)}${ctx.politica.canIncludeInvoice ? "" : " (invoice not included in the email by account policy)"}`
      : `paid in full, job ${depois.status === "completed" ? "closed" : depois.status}`,
  );
  const nota = await notaInterna(job, `${partes.join(", ")}.`);
  await registrar(admin, job, depois.status ?? "awaiting_payment", {
    origem: ctx.origem,
    saldo,
    vencimento,
    fatura: fatura.invoice.reference,
    email: email.ok ? email.canal : `failed: ${email.erro}`,
    cartao: cartao ?? null,
    nota_no_ticket: nota,
  });

  return { feito: "aprovado", status: depois.status ?? "awaiting_payment", saldo, vencimento, email, ...(cartao ? { cartao } : {}) };
}
