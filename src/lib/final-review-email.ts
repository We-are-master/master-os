import "server-only";
/**
 * E-mail final do job (relatório e/ou fatura com o Pay now do saldo), o mesmo do botão
 * "Finish work". Saiu da rota `final-review-email` em 15/10/2026 para o final check
 * automático mandar exatamente o mesmo e-mail, pelo mesmo canal (ticket do job, conversa
 * lateral no WhatsApp, ticket do cliente ou Resend).
 */
import { Resend } from "resend";
import {
  accountFinalEmailPolicyFromRow,
  canSendClientEmailWithPack,
} from "@/lib/account-final-email-policy";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailFixfy } from "@/lib/emails/fixfy-shell";
import { resolveNominalBillingParty } from "@/lib/account-billing-addressee";
import { missingBillingEmailReason } from "@/lib/invoice-send-eligibility";
import { buildInvoiceClientEmail } from "@/lib/invoice-email-template";
import { renderInvoicePdfBuffer } from "@/lib/invoice-send-email";
import { buildFinalReportEmail } from "@/lib/emails/final-report-email";
import { publicoDaCobranca } from "@/lib/emails/billing-email-common";
import { loadAccountInvoiceFormat } from "@/lib/invoice-fee-vat";
import { loadAgentReceiptParty } from "@/lib/agent-model/receipt-party";
import type { InvoiceTradeFeeJob } from "@/lib/invoice-trade-fee-split";
import { jobReportPdfPathFromStoredUrl } from "@/services/job-reports";
import { renderJobReportV2PdfBuffer } from "@/lib/pdf/render-job-report-v2";
import { getZendeskTicketId, isZendeskConfigured, sendCustomerCommentWithAttachments as zdSendCustomerComment, ticketDoWhatsApp, zendeskApi } from "@/lib/zendesk";
import { copiasDaFaturaDaConta } from "@/lib/invoice-account-cc";
import type { Account, Invoice } from "@/types/database";
import { umTicketEmail } from "@/lib/um-ticket/flags";
import { acharTicketDoPedido, type AchadoDoPedido } from "@/lib/um-ticket/achar";
import { entregarEmailNoTicket } from "@/lib/um-ticket/entregar";
import { contaDoJob } from "@/lib/processo/conta";
import { finalidadePendente, finalidadeRetido, reterCertificado } from "@/lib/certificado/regra";
import { certificateAttachmentUrls } from "@/lib/certificate-expiry";
import { chaveDeEnvio, confirmarEnvio, reservarEnvio } from "@/lib/idempotencia/envio";

type ReportRow = {
  id: string;
  phase: number;
  pdf_url: string | null;
  uploaded_at: string | null;
  created_at: string | null;
};

function bestPerPhase(rows: ReportRow[]): ReportRow[] {
  const map = new Map<number, ReportRow>();
  for (const row of rows) {
    const prev = map.get(row.phase);
    const rowTs = new Date(row.uploaded_at ?? row.created_at ?? 0).getTime();
    const prevTs = prev ? new Date(prev.uploaded_at ?? prev.created_at ?? 0).getTime() : -1;
    if (!prev || rowTs >= prevTs) map.set(row.phase, row);
  }
  return [...map.values()].sort((a, b) => a.phase - b.phase);
}

async function accountPolicyForClient(admin: SupabaseClient, clientId: string) {
  const { data: client } = await admin
    .from("clients")
    .select("source_account_id")
    .eq("id", clientId)
    .is("deleted_at", null)
    .maybeSingle();
  const aid = (client as { source_account_id?: string | null } | null)?.source_account_id?.trim();
  if (!aid) {
    return accountFinalEmailPolicyFromRow(null);
  }
  const { data: acc } = await admin.from("accounts").select("*").eq("id", aid).is("deleted_at", null).maybeSingle();
  return accountFinalEmailPolicyFromRow((acc ?? null) as Account | null);
}

export type FinalReviewEmailResult =
  | {
      ok: true;
      channel: "zendesk" | "resend";
      resendId?: string;
      ticketId?: string | number;
      attachmentCount: number;
      to: string;
      includeInvoice: boolean;
      includeReport: boolean;
      certificadoRetido: boolean;
      certificadoAnexado: boolean;
    }
  | { ok: false; status: number; error: string; detail?: string };

function falha(status: number, error: string, detail?: string): FinalReviewEmailResult {
  return { ok: false, status, error, ...(detail ? { detail } : {}) };
}

/**
 * Manda o e-mail final do job. `jobClient` lê o job (a rota passa o cliente da sessão,
 * como sempre fez); `admin` faz o resto com a chave de serviço.
 */
export async function sendFinalReviewEmail(
  admin: SupabaseClient,
  jobId: string,
  opts: {
    includeInvoice: boolean;
    includeReport: boolean;
    jobClient?: SupabaseClient;
    source?: string;
    /** E-mail do pagamento recebido (`certificado/liberar.ts`): anexa o certificado retido. */
    liberarCertificado?: boolean;
  },
): Promise<FinalReviewEmailResult> {
  const { includeInvoice, includeReport } = opts;
  const jobClient = opts.jobClient ?? admin;
  const { data: job, error: jobErr } = await jobClient
    .from("jobs")
    .select(
      "id, reference, title, client_id, client_name, partner_id, created_at, property_address, status, invoice_id, quote_id, completed_date, client_price, extras_amount, commission, partner_agreed_value, partner_cost, materials_cost, external_source, external_ref, start_report, final_report, finance_status, payment_status, account_id, customer_deposit, customer_deposit_paid",
    )
    .eq("id", jobId)
    .is("deleted_at", null)
    .maybeSingle();
  if (jobErr || !job) {
    return falha(404, "Job not found");
  }

  const j = job as Record<string, unknown>;
  const clientId = typeof j.client_id === "string" ? j.client_id : null;
  if (!clientId) {
    return falha(400, "Job has no client");
  }

  const policy = await accountPolicyForClient(admin, clientId);
  if (!canSendClientEmailWithPack(policy)) {
    return falha(400, "This account does not allow client completion emails. Update Billing on the account.");
  }
  if (includeInvoice && !policy.canIncludeInvoice) {
    return falha(400, "Invoice content is not allowed for this account.");
  }
  if (includeReport && !policy.canIncludeReport) {
    return falha(400, "Report attachments are not allowed for this account.");
  }
  if (!includeInvoice && !includeReport) {
    return falha(400, "Select at least one of invoice or report for the client email, or use internal only.");
  }

  const billing = await resolveNominalBillingParty(admin, {
    clientId,
    fallbackName: typeof j.client_name === "string" ? j.client_name : "Client",
    fallbackEmail: null,
  });
  const emailTo = billing.documentEmail?.trim();
  if (!emailTo) {
    return falha(400, missingBillingEmailReason(billing.mode));
  }

  const { data: reportRows, error: rErr } = await admin
    .from("job_reports")
    .select("id, phase, pdf_url, uploaded_at, created_at")
    .eq("job_id", jobId);
  if (rErr) {
    return falha(500, "Could not load reports");
  }
  const reports = bestPerPhase((reportRows ?? []) as ReportRow[]);

  const attachments: { filename: string; content: Buffer; contentType?: string }[] = [];
  if (includeReport) {
    for (const r of reports) {
      if (!r.pdf_url?.trim()) continue;
      const path = jobReportPdfPathFromStoredUrl(r.pdf_url);
      if (!path) continue;
      const { data: blob, error: dlErr } = await admin.storage.from("job-reports").download(path);
      if (dlErr || !blob) continue;
      const buf = Buffer.from(await blob.arrayBuffer());
      const safe = String(j.reference ?? "job").replace(/[^\w.-]+/g, "_");
      attachments.push({
        filename: `${safe}-report-${r.phase}.pdf`,
        content: buf,
        contentType: "application/pdf",
      });
    }
  }

  /**
   * Report novo (V2) em PDF (15/10/2026): jobs com o report pelo link/portal não têm
   * linha em `job_reports`, então o cliente recebia fotos soltas. Sem PDF legado, vai o
   * PDF montado do start_report + final_report (as fotos já estão dentro dele).
   */
  /**
   * Certificado só com o job pago (dono, 22/10/2026): cliente da Fixfy com saldo recebe o
   * report sem o certificado; ele sai sozinho quando o pagamento entra (`certificado/liberar.ts`).
   */
  const contaId = await contaDoJob(admin, { account_id: (j.account_id as string | null) ?? null, client_id: clientId });
  const certificadoRetido =
    includeReport &&
    reterCertificado(
      { title: j.title as string | null, status: j.status as string | null, finance_status: j.finance_status as string | null, payment_status: j.payment_status as string | null, final_report: j.final_report },
      contaId,
      { forcarAnexo: opts.liberarCertificado },
    );
  let certificadoAnexado = false;
  const urlsDoCertificado = new Set(certificateAttachmentUrls(j.final_report));

  let pdfV2Anexado = false;
  if (includeReport && attachments.length === 0) {
    try {
      const pdf = await renderJobReportV2PdfBuffer(admin, jobId);
      if (pdf) {
        attachments.push({
          filename: `${pdf.reference.replace(/[^\w.-]+/g, "_")}-report.pdf`,
          content: pdf.buffer,
          contentType: "application/pdf",
        });
        pdfV2Anexado = true;
      }
    } catch (e) {
      console.error("final-review-email: report V2 PDF failed, falls back to photos:", e);
    }
  }

  /**
   * Anexos do PRÓPRIO relatório (V2), a pedido do dono em 17/08/2026: o email
   * de conclusão ia só com o PDF legado do app do parceiro — que a maioria
   * dos jobs não tem — e o certificado do EICR, que é o produto que o
   * cliente comprou, ficava para trás. Agora o que está no relatório vai no
   * email: PDFs (certificado) primeiro, depois as fotos, com teto de 12
   * arquivos e ~15MB para não estourar o limite do Resend.
   */
  if (includeReport) {
    const urls: string[] = [];
    for (const metade of [j.final_report, j.start_report]) {
      const fotos = (metade as { photos?: unknown } | null)?.photos;
      if (Array.isArray(fotos)) {
        urls.push(...fotos.filter((s): s is string => typeof s === "string" && s.trim().length > 0));
      } else if (fotos && typeof fotos === "object") {
        for (const lista of Object.values(fotos as Record<string, unknown>)) {
          if (Array.isArray(lista)) {
            urls.push(...lista.filter((s): s is string => typeof s === "string" && s.trim().length > 0));
          }
        }
      }
    }
    urls.sort((a, b) => Number(/\.pdf(\?|$)/i.test(b)) - Number(/\.pdf(\?|$)/i.test(a)));
    let totalBytes = attachments.reduce((n, a) => n + a.content.length, 0);
    let nFoto = 0;
    let nPdf = 0;
    const safe = String(j.reference ?? "job").replace(/[^\w.-]+/g, "_");
    for (const u of [...new Set(urls)].slice(0, 12)) {
      const path = jobReportPdfPathFromStoredUrl(u);
      if (!path) continue;
      const { data: blob, error: dlErr } = await admin.storage.from("job-reports").download(path);
      if (dlErr || !blob) continue;
      const buf = Buffer.from(await blob.arrayBuffer());
      if (totalBytes + buf.length > 15 * 1024 * 1024) break;
      totalBytes += buf.length;
      const ehPdf = /\.pdf(\?|$)/i.test(u);
      // Com o PDF do report anexado, foto solta seria repetida: só seguem os PDFs (certificados).
      // Certificado = PDF do relatório ou arquivo do slot "certificate" (pode ser foto do papel).
      const ehCertificado = ehPdf || urlsDoCertificado.has(u);
      if (ehCertificado && certificadoRetido) continue;
      if (pdfV2Anexado && !ehCertificado) continue;
      if (ehCertificado) certificadoAnexado = true;
      attachments.push({
        filename: ehPdf
          ? `${safe}-certificate${++nPdf > 1 ? `-${nPdf}` : ""}.pdf`
          : `${safe}-photo-${++nFoto}.jpg`,
        content: buf,
        contentType: ehPdf ? "application/pdf" : "image/jpeg",
      });
    }
  }

  const invoiceId = typeof j.invoice_id === "string" ? j.invoice_id : null;
  let invoiceRow: Invoice | null = null;
  let quoteReference: string | null = null;

  if (includeInvoice && invoiceId) {
    const { data: inv } = await admin.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
    invoiceRow = (inv ?? null) as Invoice | null;
  }
  /**
   * Job da cotação com entrada (17/10/2026): o `invoice_id` é a fatura da entrada, já paga.
   * O e-mail final leva a fatura do SALDO (preço novo menos a entrada), com o link para pagar.
   */
  if (includeInvoice && invoiceRow?.invoice_kind === "deposit") {
    const { data: saldo } = await admin
      .from("invoices")
      .select("*")
      .eq("job_reference", String(j.reference ?? ""))
      .eq("invoice_kind", "final")
      .is("deleted_at", null)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (saldo) invoiceRow = saldo as Invoice;
  }
  // Fatura com saldo sem link gravado: grava o /pay dela, para o botão "Pay" sempre aparecer.
  if (invoiceRow && invoiceRow.status !== "paid" && !invoiceRow.stripe_payment_link_url?.trim() && invoiceRow.reference) {
    const { invoicePayLinkUrl } = await import("@/lib/pay-link-url");
    const url = invoicePayLinkUrl(invoiceRow.reference);
    const { error: linkErr } = await admin.from("invoices").update({ stripe_payment_link_url: url }).eq("id", invoiceRow.id);
    if (!linkErr) invoiceRow = { ...invoiceRow, stripe_payment_link_url: url };
  }

  const quoteId = typeof j.quote_id === "string" ? j.quote_id : null;
  if (quoteId) {
    const { data: quote } = await admin.from("quotes").select("reference").eq("id", quoteId).maybeSingle();
    quoteReference = (quote as { reference?: string } | null)?.reference?.trim() ?? null;
  }

  const { data: settings } = await admin.from("company_settings").select("company_name").limit(1).maybeSingle();
  const companyName =
    settings && (settings as { company_name?: string | null }).company_name
      ? String((settings as { company_name?: string | null }).company_name)
      : "Our team";
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? `${companyName} <onboarding@resend.dev>`;

  // Channel selection: prefer Zendesk if the job came from a ticket and the
  // env is configured; only require RESEND_API_KEY for the Resend fallback.
  const zdTicketId = getZendeskTicketId(j as { external_source?: string | null; external_ref?: string | null });
  const useZendesk = Boolean(zdTicketId && isZendeskConfigured());

  if (zdTicketId && !isZendeskConfigured()) {
    console.warn("[final-review-email] Job linked to Zendesk ticket", zdTicketId, "but Zendesk env is not configured. Falling back to Resend.");
  }

  // Um ticket por pedido (ONE_TICKET_EMAIL_ON): job sem ticket ligado, mas o cliente
  // já tem um aberto. O e-mail entra nele em vez de sair solto pela Resend.
  let achado: (AchadoDoPedido & { tipo: "ticket" }) | null = null;
  if (!useZendesk && umTicketEmail()) {
    const a = await acharTicketDoPedido(admin, { jobId, clientId, email: emailTo });
    if (a.tipo === "ticket") achado = a;
    else if (a.tipo === "ambiguo") console.log("[final-review-email] cliente com vários tickets abertos, segue pela Resend:", a.ids.join(", "));
  }

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!useZendesk && !achado && !resendKey) {
    return falha(503, "RESEND_API_KEY is not configured");
  }

  const ref = String(j.reference ?? "");
  const title = String(j.title ?? "Job");
  // Arquivos do relatório anexados ATÉ AQUI (o PDF da fatura entra depois e não conta como relatório).
  const reportAttachmentCount = includeReport ? attachments.length : 0;
  const missingReportNote =
    includeReport && reportAttachmentCount === 0
      ? "We could not attach report PDFs (missing files or storage)."
      : "";
  const publico = publicoDaCobranca(billing.mode, billing.displayName, billing.companyName);

  const tradeFeeJob: InvoiceTradeFeeJob | null =
    typeof j.client_price === "number"
      ? {
          client_price: j.client_price,
          extras_amount: typeof j.extras_amount === "number" ? j.extras_amount : undefined,
          commission: typeof j.commission === "number" ? j.commission : 0,
          partner_agreed_value: typeof j.partner_agreed_value === "number" ? j.partner_agreed_value : 0,
          partner_cost: typeof j.partner_cost === "number" ? j.partner_cost : 0,
          materials_cost: typeof j.materials_cost === "number" ? j.materials_cost : 0,
        }
      : null;

  // Schedule A (modelo de agente): recibo em nome do profissional. Null = B.
  const agentParty = await loadAgentReceiptParty(admin, {
    id: typeof j.id === "string" ? j.id : null,
    client_id: clientId,
    created_at: typeof j.created_at === "string" ? j.created_at : null,
    partner_id: typeof j.partner_id === "string" ? j.partner_id : null,
  });
  // Conta com VAT só na taxa (mig 323): corpo e PDF no mesmo formato.
  const formatoDaConta =
    includeInvoice && invoiceRow && !agentParty
      ? await loadAccountInvoiceFormat(admin, invoiceRow.source_account_id ?? billing.sourceAccountId ?? null, 0)
      : null;
  const feeVat = formatoDaConta ? { ratePct: formatoDaConta.feeVat.ratePct, vatNumber: formatoDaConta.feeVat.vatNumber } : null;

  // A fatura vai em PDF junto: é o documento que o cliente guarda, e é o mesmo do botão "Send via email".
  let invoicePdfAttached = false;
  if (includeInvoice && invoiceRow) {
    const pdf = await renderInvoicePdfBuffer(admin, invoiceRow.id);
    if ("error" in pdf) console.error("final-review-email invoice PDF:", pdf.error);
    else {
      attachments.push({ filename: `${pdf.reference.replace(/[^\w.-]+/g, "_")}.pdf`, content: pdf.buffer, contentType: "application/pdf" });
      invoicePdfAttached = true;
    }
  }

  // E-mail final no layout do Welcome (dono, 22/10/2026): 3 fotos do trabalho, o botão do
  // report completo (o PDF, por link que dura semanas) e o "What we did." do parceiro.
  const visual = includeReport ? await visualDoFinal(admin, jobId, j, attachments) : { fotos: null, resumo: null };

  // Copy 12 (relatório + fatura, ou recibo se já pago) ou 13 (só relatório), na moldura única.
  // Duas versões do mesmo texto: e-mail inteiro (Resend / ticket) e comentário público do Zendesk.
  const montar = (zendesk: boolean) => {
    if (includeInvoice && invoiceRow) {
      const e = buildInvoiceClientEmail(
        invoiceRow,
        {
          clientName: billing.displayName,
          jobTitle: title,
          propertyAddress: typeof j.property_address === "string" ? j.property_address : null,
          // `jobs.service_type` não existe em produção: pedi-la fazia a rota inteira responder "Job not found".
          serviceType: title,
          completionDate:
            typeof j.completed_date === "string"
              ? j.completed_date
              : new Date().toISOString().slice(0, 10),
          quoteReference,
          billingMode: billing.mode,
          jobReference: ref,
        },
        tradeFeeJob,
        {
          final: true,
          reportAttachmentCount,
          certificado: certificadoRetido ? "retido" : opts.liberarCertificado && certificadoAnexado ? "liberado" : undefined,
          deposito:
            j.customer_deposit_paid && Number(j.customer_deposit) > 0
              ? { pago: Number(j.customer_deposit), total: Number(j.client_price ?? 0) + Number(j.extras_amount ?? 0) }
              : null,
          missingReportNote: missingReportNote || undefined,
          fotos: visual.fotos,
          resumo: visual.resumo,
          documentAttached: invoicePdfAttached,
          // Schedule A (modelo de agente): recibo em nome do profissional. Null = B.
          agentParty,
          feeVat,
          zendesk,
        },
      );
      return { subject: e.subject, html: e.html, text: e.text };
    }
    return buildFinalReportEmail({
      publico,
      jobReference: ref,
      service: title,
      propertyAddress: typeof j.property_address === "string" ? j.property_address : null,
      reportAttachmentCount,
      reportRequested: includeReport,
      certificado: certificadoRetido ? "retido" : opts.liberarCertificado && certificadoAnexado ? "liberado" : undefined,
      fotos: visual.fotos,
      resumo: visual.resumo,
      zendesk,
    });
  };
  const emailFinal = montar(false);
  const html = emailFinal.html;
  const emailSubject = emailFinal.subject;

  // Cópia pedida pela conta (o financeiro do cliente), só quando a fatura vai junto (mig 324).
  const ccDaConta = includeInvoice && invoiceRow ? await copiasDaFaturaDaConta(admin, invoiceRow.source_account_id ?? billing.sourceAccountId ?? null, [emailTo]) : [];

  let channel: "zendesk" | "resend" | undefined;
  let resendId: string | undefined;
  let ticketUsado: string | number | undefined = zdTicketId ?? undefined;

  // Ticket de WhatsApp ligado ao job (dono, 15/10/2026: "fica tudo no mesmo ticket na side"):
  // o e-mail final sai SEMPRE como conversa lateral por e-mail desse ticket. Antes, sem a chave
  // ONE_TICKET_WA_LINKED_ON, virava comentário público, ou seja, HTML no WhatsApp do cliente.
  let soEmail = false;
  if (useZendesk && (await ticketDoWhatsApp(zdTicketId!))) {
    achado = { tipo: "ticket", id: Number(zdTicketId), origem: "job", canal: "whatsapp", status: "open", candidatos: [], b2b: false, email: emailTo, telefone: null };
    soEmail = true;
  }

  if (useZendesk && !achado) {
    try {
      // No Zendesk a cópia é do ticket: quem está em CC recebe a resposta pública.
      if (ccDaConta.length) {
        await zendeskApi(`tickets/${zdTicketId}.json`, { method: "PUT", body: { ticket: { email_ccs: ccDaConta.map((e) => ({ user_email: e, action: "put" })) } } }).catch((e) => console.warn("final-review-email cc:", e instanceof Error ? e.message : e));
      }
      await zdSendCustomerComment({
        ticketId:    zdTicketId!,
        htmlBody:    montar(true).html,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      channel = "zendesk";
    } catch (err) {
      console.error("final-review-email Zendesk:", err);
      return falha(502, "Failed to deliver via Zendesk", err instanceof Error ? err.message : String(err));
    }
  } else if (achado) {
    // Falha aqui com o ticket já ligado ao job: devolve erro, como o caminho do Zendesk sempre fez.
    const ligado = useZendesk;
    try {
      const r = await entregarEmailNoTicket({
        ticket: achado,
        para: { email: emailTo, nome: billing.displayName },
        cc: ccDaConta,
        assunto: emailSubject,
        html,
        anexos: attachments,
        soEmail,
      });
      channel = "zendesk";
      ticketUsado = r.ticketId;
      console.log(`[final-review-email] ${ref}: no ticket #${r.ticketId} do cliente (${r.modo}), sem ticket novo`);
    } catch (err) {
      if (ligado) {
        console.error("final-review-email Zendesk:", err);
        return falha(502, "Failed to deliver via Zendesk", err instanceof Error ? err.message : String(err));
      }
      // O cliente não pode ficar sem o e-mail: cai para a Resend como antes.
      console.error("[final-review-email] ticket do cliente falhou, segue pela Resend:", err);
    }
  }
  if (!channel) {
    if (!resendKey) return falha(503, "RESEND_API_KEY is not configured");
    const resend = new Resend(resendKey);
    const { data: sent, error: sendErr } = await resend.emails.send({
      from: fromEmail,
      to: [emailTo],
      ...(ccDaConta.length ? { cc: ccDaConta } : {}),
      subject: emailSubject,
      html,
      text: emailFinal.text,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    if (sendErr) {
      console.error("final-review-email Resend:", sendErr);
      return falha(502, sendErr.message ?? "Email send failed");
    }
    channel = "resend";
    resendId = sent?.id;
  }

  const now = new Date().toISOString();
  // A fatura saiu para o cliente: marca o envio (libera o lembrete de cobrança) e deixa no histórico.
  if (includeInvoice && invoiceRow) {
    const { error: sentErr } = await admin.from("invoices").update({ sent_at: now }).eq("id", invoiceRow.id);
    if (sentErr) console.warn("final-review-email sent_at:", sentErr.message);
    const { error: auditErr } = await admin.from("audit_logs").insert({
      entity_type: "invoice",
      entity_id: invoiceRow.id,
      entity_ref: invoiceRow.reference,
      action: "bulk_update",
      field_name: "email_sent",
      new_value: emailTo,
      metadata: { email_to: emailTo, channel, source: opts.source ?? "final_review", job: ref },
    });
    if (auditErr) console.warn("final-review-email audit:", auditErr.message);
  }
  const { error: upErr } = await admin
    .from("jobs")
    .update({ review_sent_at: now, review_send_method: channel === "zendesk" ? "zendesk" : "email" })
    .eq("id", jobId);
  if (upErr) {
    console.error("final-review-email job update:", upErr);
  }

  // Saiu com saldo: quando o pagamento entrar, a varredura manda o recibo com a fatura final paga.
  if (includeInvoice && invoiceRow && invoiceRow.status !== "paid" && !opts.liberarCertificado) {
    const chave = chaveDeEnvio("recibo-pendente", jobId);
    const r = await reservarEnvio(admin, { chave, finalidade: finalidadePendente, canal: "email", jobId, destinatario: emailTo, motivo: invoiceRow.id });
    if (r.reservado) await confirmarEnvio(admin, chave);
  }

  // Marca o certificado retido: a varredura do pagamento só manda para quem ficou esperando.
  if (certificadoRetido) {
    const chave = chaveDeEnvio("certificado-retido", jobId);
    const r = await reservarEnvio(admin, { chave, finalidade: finalidadeRetido, canal: "email", jobId, destinatario: emailTo, motivo: "certificate held until the job is paid" });
    if (r.reservado) await confirmarEnvio(admin, chave);
  }

  return {
    ok: true,
    channel: channel as "zendesk" | "resend",
    resendId,
    ticketId: channel === "zendesk" ? ticketUsado : undefined,
    attachmentCount: attachments.length,
    to: emailTo,
    includeInvoice,
    includeReport,
    certificadoRetido,
    certificadoAnexado,
  };
}

/** Links do e-mail final duram o bastante para o cliente voltar depois (60 dias). */
const LINK_DO_FINAL_SEG = 60 * 24 * 60 * 60;
const FOTO_DESENHAVEL = /\.(jpe?g|png)(\?|$)/i;

/**
 * As 3 fotos do trabalho (as de depois; sem elas, as de antes), o link do PDF do report
 * e o texto do parceiro. O PDF anexado sobe para o storage para o botão "See the full
 * report" abrir no navegador. Falhou alguma parte: o e-mail sai sem ela.
 */
async function visualDoFinal(
  admin: SupabaseClient,
  jobId: string,
  j: Record<string, unknown>,
  anexos: Array<{ filename: string; content: Buffer; contentType?: string }>,
): Promise<{ fotos: EmailFixfy["fotos"]; resumo: EmailFixfy["resumo"] }> {
  const doCertificado = new Set(certificateAttachmentUrls(j.final_report));
  const fotosDe = (r: unknown): string[] => {
    const ph = (r as { photos?: unknown } | null)?.photos;
    const todas = Array.isArray(ph) ? ph : ph && typeof ph === "object" ? Object.values(ph as Record<string, unknown>).flat() : [];
    return todas.filter((u): u is string => typeof u === "string" && FOTO_DESENHAVEL.test(u) && !doCertificado.has(u));
  };
  const escolhidas = (fotosDe(j.final_report).length ? fotosDe(j.final_report) : fotosDe(j.start_report)).slice(0, 3);
  const lista: Array<{ url: string }> = [];
  for (const u of escolhidas) {
    const path = jobReportPdfPathFromStoredUrl(u);
    if (!path) continue;
    const { data } = await admin.storage.from("job-reports").createSignedUrl(path, LINK_DO_FINAL_SEG);
    if (data?.signedUrl) lista.push({ url: data.signedUrl });
  }

  let link: string | null = null;
  const pdf = anexos.find((a) => /-report(-\d+)?\.pdf$/i.test(a.filename));
  if (pdf) {
    const caminho = `email-final/${jobId}/${pdf.filename}`;
    const { error } = await admin.storage.from("job-reports").upload(caminho, pdf.content, { contentType: "application/pdf", upsert: true });
    if (!error) {
      const { data } = await admin.storage.from("job-reports").createSignedUrl(caminho, LINK_DO_FINAL_SEG);
      link = data?.signedUrl ?? null;
    } else console.warn("final-review-email: report PDF upload failed:", error.message);
  }

  const campos = ((j.final_report as { fields?: Record<string, unknown> } | null)?.fields ?? j.final_report ?? {}) as Record<string, unknown>;
  const descricao = typeof campos.description === "string" && campos.description.trim() && !/ticket\s*#?\d+|from the partner|zendesk/i.test(campos.description) ? campos.description.trim() : null;
  return {
    fotos: lista.length || link ? { lista, link: link ? { label: "See the full report", url: link } : null } : null,
    resumo: descricao ? { titulo: "What we did.", texto: descricao } : null,
  };
}
