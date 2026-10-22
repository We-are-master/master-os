import "server-only";
import type { Invoice } from "@/types/database";
import { invoiceAmountPaid, invoiceBalanceDue } from "@/lib/invoice-balance";
import { isInvoicePaymentVerified } from "@/lib/invoice-payment-verified";
import { splitInvoiceTradeAndFee, type InvoiceTradeFeeJob, type SplitInvoiceTradeFeeOptions } from "@/lib/invoice-trade-fee-split";
import { splitFeeVat } from "@/lib/invoice-fee-vat";
import { invoicePayLinkForClient } from "@/lib/pay-link-url";
import {
  buildAgentReceiptView,
  type AgentReceiptParty,
  type AgentReceiptView,
} from "@/lib/agent-model/receipt-view";
import { dataLonga, emailFixfy, gbp, saudacao, type EmailFixfy } from "@/lib/emails/fixfy-shell";
import { passosAte, PASSOS_FATURA } from "@/lib/emails/faixas-do-email";
import {
  dadosBancariosVerificados,
  nomeDoDocumento,
  nomeDoDocumentoAberto,
  publicoDaCobranca,
  referenciaDeCobranca,
  semTravessao,
} from "@/lib/emails/billing-email-common";

/**
 * E-mail da fatura ao cliente (copy 10), do recibo (11) e do e-mail final com
 * fatura (12), na moldura única (`emailFixfy`, desenho de app aprovado em 20/10/2026).
 *
 * O HTML antigo (`email-templates/invoice-client.html`) não é mais lido; o PDF
 * continua o mesmo. Toda a letra pequena de antes segue aqui: o detalhamento do
 * valor (trade + management fee, ou as linhas do profissional), o quadro de VAT
 * (Need a VAT invoice? / VAT só na taxa), e em Schedule A quem é o profissional,
 * com quem o cliente contratou e que a Fixfy recebe como agente.
 */

export type InvoiceClientEmailContext = {
  clientName: string;
  jobTitle: string;
  propertyAddress?: string | null;
  postcode?: string | null;
  serviceType?: string | null;
  completionDate?: string | null;
  quoteReference?: string | null;
  /** "account" = cobrança da conta (B2B, "Hi {empresa} team,"); senão B2C. */
  billingMode?: "account" | "end_client" | null;
  /** Empresa da conta (saudação B2B). */
  companyName?: string | null;
  /** JOB-9800, para "Booking" e o assunto do e-mail final. */
  jobReference?: string | null;
};

export type InvoiceEmailOptions = {
  /** E-mail final (copy 12): quantos arquivos do relatório foram anexados. */
  reportAttachmentCount?: number;
  /** Relatório pedido mas sem arquivo: o e-mail diz que não foi anexado. */
  missingReportNote?: string;
  customMessage?: string;
  /** £ amount requested in this send (may be % of balance). */
  amountDueNow?: number;
  /** % of invoice base used for this request (0–100). */
  requestPercent?: number;
  /** Statement trade/fee split options (platform fee % fallback). */
  tradeFeeOptions?: SplitInvoiceTradeFeeOptions;
  /**
   * Schedule A (modelo de agente): o profissional em nome de quem o recibo sai.
   * Vem de `loadAgentReceiptParty`. Ausente = Schedule B.
   */
  agentParty?: AgentReceiptParty | null;
  /**
   * Conta com `invoice_fee_vat` (mig 323): a letra pequena mostra o serviço do
   * parceiro sem VAT e a taxa da Fixfy em líquido + VAT, igual ao PDF.
   */
  feeVat?: { ratePct: number; vatNumber: string } | null;
  /** O PDF da fatura/recibo vai anexado (só diga "attached" se o PDF saiu). */
  documentAttached?: boolean;
  /** E-mail final do job (copy 12): o trabalho está concluído. */
  final?: boolean;
  /** Comentário público do Zendesk: sem tabelas internas. */
  zendesk?: boolean;
  /** Linhas da conta para transferência; padrão = a conta verificada da configuração (a do PDF). */
  bankRows?: Array<[string, string]>;
};

export type InvoiceClientEmail = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  /** invoice | statement | receipt */
  documentName: string;
  billingReference: string;
};

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Endereço com o postcode, sem repetir o postcode. */
function enderecoCompleto(address?: string | null, postcode?: string | null): string {
  const a = semTravessao(address);
  const pc = String(postcode ?? "").trim().toUpperCase();
  if (!pc) return a;
  if (a.toUpperCase().replace(/\s+/g, "").includes(pc.replace(/\s+/g, ""))) return a;
  return [a, pc].filter(Boolean).join(", ");
}

function dataDoPagamento(inv: Invoice): string | null {
  return dataLonga(inv.stripe_paid_at ?? inv.paid_date ?? inv.last_payment_date ?? null);
}

/** Só o que se sabe: pagamento verificado pela Stripe = cartão. Sem prova, a linha some. */
function metodoDoPagamento(inv: Invoice): string | null {
  if (inv.stripe_paid_at || inv.stripe_payment_status === "paid") return "Card";
  return null;
}

/** Schedule A: linhas do profissional, VAT dele, promoção. Em texto (letra pequena). */
function detalheDoAgente(view: AgentReceiptView, paid: boolean): string[] {
  const out: string[] = [];
  const itens = view.lines.map((l) => `${semTravessao(l.label)} ${gbp(l.amount)}`);
  if (itens.length) out.push(`Services: ${itens.join(". ")}.`);
  if (view.lines.length > 1 || view.vatLine || view.promotion > 0.02) {
    out.push(`${view.professionalName ? `${view.professionalName}'s price` : "Price"}: ${gbp(view.professionalPrice)}.`);
  }
  if (view.vatLine) {
    const vat = view.vatAmount != null ? ` (${gbp(view.vatAmount)})` : "";
    out.push(`${semTravessao(view.vatLine).replace(/\.$/, "")}${vat}${view.vatNumber ? `. VAT number ${view.vatNumber}` : ""}.`);
  }
  if (view.promotion > 0.02) out.push(`Fixfy promotion, paid by Fixfy on your behalf: -${gbp(view.promotion)}.`);
  if (view.partOfPrice) out.push(`${paid ? "This receipt covers" : "This statement covers"} ${gbp(view.documentAmount)}.`);

  const nome = view.professionalName;
  out.push(
    nome
      ? `Your professional: ${nome}, an independent trader. They offer their services as a business, and your contract for this job is with them.`
      : "Your job is carried out by an independent, vetted professional, named in your booking confirmation.",
  );
  if (nome && view.businessAddress) out.push(`Business address: ${semTravessao(view.businessAddress)}.`);
  if (nome) out.push(view.vatNumber ? `VAT: VAT registered, VAT number ${view.vatNumber}.` : "VAT: Not VAT registered, so no VAT is charged.");
  out.push(`${semTravessao(view.issuerLine).replace(/\.$/, "")}.`);
  out.push(semTravessao(view.paymentNote));
  out.push(semTravessao(view.bookingNote));
  return out.filter(Boolean);
}

/** Schedule B: trade + management fee (ou com VAT só na taxa), e o quadro de VAT. */
function detalheSchedB(a: {
  trade: number;
  fee: number;
  feeVat: { net: number; vat: number; ratePct: number; vatNumber: string } | null;
  paid: boolean;
  docAberto: string;
}): string[] {
  const out: string[] = [];
  if (a.feeVat) {
    out.push(
      `Payment breakdown: Trade services, passed through at cost with no VAT, ${gbp(a.trade)}. Fixfy management fee (net), for coordination, vetting and quality assurance, ${gbp(a.feeVat.net)}. VAT at ${a.feeVat.ratePct}% on the Fixfy management fee only, ${gbp(a.feeVat.vat)}.`,
    );
    out.push(
      `VAT: Getfixfy Ltd, VAT No. ${a.feeVat.vatNumber}. VAT is charged on the Fixfy management fee only. Trade services are passed through at cost, with no VAT added by Fixfy.`,
    );
  } else {
    out.push(
      `Payment breakdown: Trade services, performed by the assigned trade provider, ${gbp(a.trade)}. Fixfy management fee, for coordination, vetting and quality assurance, ${gbp(a.fee)}.`,
    );
    out.push(`Need a VAT invoice? Request one at hello@getfixfy.com.`);
  }
  out.push(
    a.paid
      ? "This receipt confirms your payment to Getfixfy Ltd for the work above."
      : `This ${a.docAberto} from Getfixfy Ltd covers the work above.`,
  );
  return out;
}

/**
 * Fixfy client invoice / payment receipt email (copy 10, 11, 12).
 * "Payment received" só com pagamento verificado (`isInvoicePaymentVerified`).
 */
export function buildInvoiceClientEmail(
  invoice: Invoice,
  context: InvoiceClientEmailContext,
  job?: InvoiceTradeFeeJob | null,
  options?: InvoiceEmailOptions,
): InvoiceClientEmail {
  const paid = isInvoicePaymentVerified(invoice);
  const invAmt = Math.max(0, round2(Number(invoice.amount ?? 0)));
  const paidAmt = round2(invoiceAmountPaid(invoice));
  const balanceDue = invoiceBalanceDue(invoice);
  const fullDue = balanceDue > 0.02 ? balanceDue : invAmt;
  const amountDueNow =
    !paid && options?.amountDueNow != null && options.amountDueNow > 0 ? round2(options.amountDueNow) : fullDue;
  const isPartialRequest =
    !paid && options?.amountDueNow != null && options.amountDueNow > 0.02 && Math.abs(amountDueNow - fullDue) > 0.02;
  const partial = !paid && paidAmt > 0.02;

  const agentView = options?.agentParty
    ? buildAgentReceiptView({
        party: options.agentParty,
        jobTitle: context.jobTitle,
        clientPrice: job?.client_price,
        extrasAmount: job?.extras_amount,
        invoiceAmount: invAmt,
        paid,
      })
    : null;
  const { trade, fee } = splitInvoiceTradeAndFee(invAmt, job, {
    ...options?.tradeFeeOptions,
    schedule: agentView ? "A" : options?.tradeFeeOptions?.schedule,
  });
  const feeVat = !agentView && options?.feeVat ? { ...splitFeeVat(fee, options.feeVat.ratePct), ...options.feeVat } : null;

  const docName = nomeDoDocumento({ pago: paid, agente: Boolean(agentView) });
  const docAberto = nomeDoDocumentoAberto(Boolean(agentView));
  const ref = referenciaDeCobranca(invoice.reference);
  const service = semTravessao(context.serviceType?.trim() || context.jobTitle || "your job");
  const property = enderecoCompleto(context.propertyAddress, context.postcode) || null;
  const jobRef = String(context.jobReference ?? invoice.job_reference ?? "").trim() || null;
  const due = dataLonga(invoice.due_date ?? null);
  const attached = Boolean(options?.documentAttached);
  const reportCount = Math.max(0, options?.reportAttachmentCount ?? 0);
  const reportMissing = Boolean(options?.missingReportNote?.trim());
  const final = Boolean(options?.final);
  const zendesk = Boolean(options?.zendesk);
  const greeting = saudacao(publicoDaCobranca(context.billingMode, context.clientName, context.companyName));

  // Link de pagamento: pedido parcial cobra a % pelo /pay do OS.
  const payLinkBase = paid ? "" : invoicePayLinkForClient(invoice.reference, invoice.stripe_payment_link_url);
  const requestPct = Math.round(Number(options?.requestPercent ?? 0));
  const payLink =
    payLinkBase && isPartialRequest && payLinkBase.includes("/pay/") && requestPct >= 1 && requestPct <= 99
      ? `${payLinkBase.split("?")[0]}?pct=${requestPct}`
      : payLinkBase;

  // Letra pequena: o detalhamento e as divulgações de sempre.
  const letra: string[] = [];
  if (agentView) letra.push(...detalheDoAgente(agentView, paid));
  else letra.push(...detalheSchedB({ trade, fee, feeVat, paid, docAberto }));
  if (partial) letra.push(`Already paid: ${gbp(paidAmt)}. Balance due: ${gbp(fullDue)}.`);
  if (isPartialRequest) letra.push(`This request is ${requestPct}% of the ${gbp(fullDue)} balance.`);
  letra.push(`${paid ? "Total paid" : "Total"}: ${gbp(invAmt)}.`);
  if (context.quoteReference?.trim()) letra.push(`Linked to quote QT-${context.quoteReference.trim().replace(/^QT-/i, "")}.`);
  if (!paid && agentView) letra.push(`Bank transfers are paid to Fixfy, as agent for ${agentView.professionalLabel}.`);

  const banco = (options?.bankRows ?? dadosBancariosVerificados()).filter(([, v]) => String(v ?? "").trim());
  const transferencia = !paid && ref && banco.length ? { dadosBancarios: banco, referencia: ref } : null;
  const cta = !paid && payLink ? { label: `Pay ${gbp(amountDueNow)}`, url: payLink } : null;
  const custom = options?.customMessage?.trim() || null;

  let shell: EmailFixfy;
  let subject: string;

  if (final) {
    // Copy 12: o e-mail final do job com a fatura (ou o recibo, se já está paga).
    const p1 =
      reportCount > 0
        ? "The agreed work is complete, and your final report is attached. We hope you’re pleased with the result."
        : "The agreed work is complete. We hope you’re pleased with the result.";
    const pMissing = reportMissing ? "We couldn’t attach the report files to this email. Just reply and we’ll send you a copy." : null;
    const p2 = paid
      ? attached
        ? "Your payment receipt is also attached. Thank you for your payment."
        : "Thank you for your payment. There is nothing left to pay."
      : `${attached ? `Your ${docName} is also included. ` : ""}The remaining amount to pay is ${gbp(amountDueNow)}${due ? `, due by ${due}` : ""}.`;
    const p3 =
      reportCount > 0
        ? "Please have a look through the report. If anything needs our attention, just reply and let us know."
        : "If anything needs our attention, just reply and let us know.";
    subject = reportCount > 0 ? `Your job report and ${docName} · ${jobRef ?? ref}` : `Your ${docName} · ${jobRef ?? ref}`;
    shell = {
      preheader: paid
        ? reportCount > 0
          ? "Your report and payment receipt are attached."
          : "Thank you for your payment."
        : reportCount > 0
          ? `Your report is attached, with ${gbp(amountDueNow)} due${due ? ` by ${due}` : ""}.`
          : `${gbp(amountDueNow)} due${due ? ` by ${due}` : ""} for ${service}.`,
      estado: paid ? { texto: "Payment received", cor: "green" } : { texto: "Payment due", cor: "red" },
      titulo: "Your work is complete",
      destaque: paid ? { linha1: `${gbp(paidAmt || invAmt)} paid`, linha2: dataDoPagamento(invoice) ? `on ${dataDoPagamento(invoice)}` : null } : { linha1: `${gbp(amountDueNow)} due`, linha2: due ? `by ${due}` : null },
      metricas: paid
        ? [
            { rotulo: "Amount paid", valor: gbp(paidAmt || invAmt) },
            { rotulo: "Paid on", valor: dataDoPagamento(invoice) ?? "" },
          ]
        : [
            { rotulo: "Amount due", valor: gbp(amountDueNow) },
            { rotulo: "Due by", valor: due ?? "" },
          ],
      passos: passosAte(PASSOS_FATURA, paid ? 3 : 2),
      saudacao: greeting,
      paragrafos: [custom ?? p1, ...(pMissing ? [pMissing] : []), p2, p3],
      linhas: [
        ["Service", service],
        ["Property", property],
        ["Booking", jobRef],
        ["Billing reference", ref],
        ["Balance due", paid ? null : gbp(amountDueNow)],
        ["Due date", paid ? null : due],
      ],
      cta,
      transferencia,
      letraPequena: letra,
      zendesk,
    };
  } else if (paid) {
    // Copy 11: recibo. Valor RECEBIDO (amount_paid), nunca o total da fatura.
    const recebido = paidAmt > 0.02 ? paidAmt : invAmt;
    const totalDoJob = job ? round2(Number(job.client_price ?? 0) + Number(job.extras_amount ?? 0)) : 0;
    const ehEntrada = String((invoice as { invoice_kind?: string | null }).invoice_kind ?? "") === "deposit";
    const restante = ehEntrada && totalDoJob > 0 ? round2(totalDoJob - recebido) : 0;
    const frasePagamento =
      restante > 0.02
        ? `Your remaining balance is ${gbp(restante)}, due on completion of the work.`
        : `There is no remaining balance on this ${docAberto}.`;
    subject = `Payment received · ${ref}`;
    shell = {
      preheader: attached ? `Thank you. Your receipt for ${gbp(recebido)} is attached.` : `Thank you for your payment of ${gbp(recebido)}.`,
      estado: { texto: "Payment received", cor: "green" },
      titulo: "Thank you for your payment",
      destaque: { linha1: `${gbp(recebido)} received`, linha2: dataDoPagamento(invoice) ? `on ${dataDoPagamento(invoice)}` : null },
      metricas: [
        { rotulo: "Amount received", valor: gbp(recebido), sub: dataDoPagamento(invoice) ? `on ${dataDoPagamento(invoice)}` : null },
        restante > 0.02
          ? { rotulo: "Balance", valor: gbp(restante), sub: "due on completion" }
          : { rotulo: "Balance", valor: gbp(0) },
      ],
      // Recibo de sinal: a reserva está feita, o trabalho ainda não. Recibo do resto: pago.
      passos: passosAte(PASSOS_FATURA, ehEntrada ? 0 : 3),
      saudacao: greeting,
      paragrafos: [
        custom ?? `We’ve received ${gbp(recebido)} for ${service}.${attached ? " Your receipt is attached for your records." : ""}`,
        frasePagamento,
        "If you have any questions about the payment, just reply and we’ll help.",
      ],
      linhas: [
        ["Reference", ref],
        ["Amount received", gbp(recebido)],
        ["Payment date", dataDoPagamento(invoice)],
        ["Payment method", metodoDoPagamento(invoice)],
        ["Booking", jobRef],
        ["Remaining balance", restante > 0.02 ? gbp(restante) : null],
      ],
      letraPequena: letra,
      zendesk,
    };
  } else {
    // Copy 10: fatura (ou statement) com valor a pagar.
    subject = `Your ${docName} ${ref} is ready`;
    shell = {
      preheader: `${gbp(amountDueNow)} due${due ? ` by ${due}` : ""} for ${service}.`,
      estado: { texto: "Payment due", cor: "red" },
      titulo: `Your ${docName} is ready`,
      destaque: { linha1: `${gbp(amountDueNow)} due`, linha2: due ? `by ${due}` : null },
      metricas: [
        { rotulo: "Amount due", valor: gbp(amountDueNow) },
        { rotulo: "Due by", valor: due ?? "" },
      ],
      // Fatura de sinal sai antes do trabalho: a reserva é o passo atual.
      passos: passosAte(
        PASSOS_FATURA,
        String((invoice as { invoice_kind?: string | null }).invoice_kind ?? "") === "deposit" ? 0 : 2,
      ),
      saudacao: greeting,
      paragrafos: [
        custom ?? `Your ${docName} for ${service} is ready. You’ll find the amount due and payment details below.`,
        `Please pay ${gbp(amountDueNow)}${due ? ` by ${due}` : ""}, using the button or bank details provided.`,
        "If anything needs clarifying, just reply. We’re happy to help.",
      ],
      linhas: [
        ["Reference", ref],
        ["Service", service],
        ["Property", property],
        ["Amount due", gbp(amountDueNow)],
        ["Due date", due],
      ],
      cta,
      transferencia,
      letraPequena: letra,
      zendesk,
    };
  }

  const { html, text } = emailFixfy(shell);
  return { subject, preheader: shell.preheader, html, text, documentName: docName, billingReference: ref };
}

/** HTML só (pré-visualização `/api/invoices/email-preview` e chamadores antigos). */
export function buildInvoiceClientEmailHTML(
  invoice: Invoice,
  context: InvoiceClientEmailContext,
  job?: InvoiceTradeFeeJob | null,
  options?: InvoiceEmailOptions,
): string {
  return buildInvoiceClientEmail(invoice, context, job, options).html;
}
