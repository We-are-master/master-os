import "server-only";
import { readFileSync } from "fs";
import { join } from "path";
import { format, parseISO, isValid } from "date-fns";
import type { Invoice } from "@/types/database";
import { invoiceAmountPaid, invoiceBalanceDue } from "@/lib/invoice-balance";
import { isInvoicePaymentVerified } from "@/lib/invoice-payment-verified";
import { splitInvoiceTradeAndFee, type InvoiceTradeFeeJob, type SplitInvoiceTradeFeeOptions } from "@/lib/invoice-trade-fee-split";
import { displayBillingReference } from "@/lib/billing-reference";
import { FIXFY_CLIENT_BANK_DETAIL_ROWS } from "@/lib/fixfy-client-bank-details";
import { invoicePayLinkForClient } from "@/lib/pay-link-url";
import {
  buildAgentReceiptView,
  type AgentReceiptParty,
  type AgentReceiptView,
} from "@/lib/agent-model/receipt-view";

export type InvoiceClientEmailContext = {
  clientName: string;
  jobTitle: string;
  propertyAddress?: string | null;
  postcode?: string | null;
  serviceType?: string | null;
  completionDate?: string | null;
  quoteReference?: string | null;
};

export type InvoiceEmailOptions = {
  /** When set, prepends a note that report PDFs are attached. */
  reportAttachmentCount?: number;
  /** Shown when reports were requested but files could not be attached. */
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
   * Vem de `loadAgentReceiptParty`. Ausente = Schedule B, e-mail de sempre.
   */
  agentParty?: AgentReceiptParty | null;
};

const PAID_INTRO =
  "We've received your payment for the work below. Thanks for choosing Fixfy.";
const UNPAID_INTRO =
  "Your job is complete. Please find your statement of charges below — payment details are included.";
const PARTIAL_INTRO =
  "We've received a partial payment. The remaining balance is shown below.";


/**
 * Schedule B: as duas linhas de sempre ("Trade services" + taxa da Fixfy),
 * tiradas do HTML para o template aceitar também o recibo de agente. Em B a
 * Fixfy vende como principal, então a taxa é "management fee", nunca
 * "platform fee" (B não se diz plataforma nem agente).
 */
const B_CHARGES_ROWS = `                <tr>
                  <td style="padding:14px 20px; border-bottom:1px solid #F2F0FA;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td valign="middle">
                          <p style="margin:0; font-size:14px; color:#1A1A1A;">Trade services</p>
                          <p style="margin:2px 0 0 0; font-size:11px; color:#9A9AA8;">Performed by the assigned trade provider</p>
                        </td>
                        <td valign="middle" align="right" style="font-size:14px; color:#020040; font-weight:600;">£{{trade_amount}}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 20px; border-bottom:1px solid #F2F0FA;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td valign="middle">
                          <p style="margin:0; font-size:14px; color:#1A1A1A;">Fixfy management fee</p>
                          <p style="margin:2px 0 0 0; font-size:11px; color:#9A9AA8;">Coordination, vetting &amp; quality assurance</p>
                        </td>
                        <td valign="middle" align="right" style="font-size:14px; color:#020040; font-weight:600;">£{{fixfy_fee}}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
`;

/** Schedule B: o quadro "Need a VAT invoice?" de sempre. */
const B_VAT_BOX = `          <tr>
            <td class="px" style="padding:0 40px 24px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFF1EA; border-left:4px solid #ED4B00; border-radius:0 6px 6px 0;">
                <tr>
                  <td style="padding:14px 18px;">
                    <p style="margin:0 0 6px 0; padding:0; font-size:10px; font-weight:700; letter-spacing:2px; color:#ED4B00; text-transform:uppercase;">
                      Need a VAT invoice?
                    </p>
                    <p style="margin:0; padding:0; font-size:13px; line-height:19px; color:#020040;">
                      Request one at <a href="mailto:support@getfixfy.com" style="color:#020040; font-weight:600; text-decoration:none;">support@getfixfy.com</a>.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

`;

let cachedTemplate: string | null = null;

function loadInvoiceClientTemplate(): string {
  if (cachedTemplate) return cachedTemplate;
  cachedTemplate = readFileSync(
    join(process.cwd(), "src/lib/email-templates/invoice-client.html"),
    "utf8",
  );
  return cachedTemplate;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatMoneyPlain(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function clientFirstName(fullName: string): string {
  const t = fullName.trim();
  if (!t) return "there";
  return t.split(/\s+/)[0] ?? t;
}

function refForTemplate(reference: string, prefix: string): string {
  const re = new RegExp(`^${prefix}-`, "i");
  return reference.replace(re, "").trim() || reference;
}

function formatDisplayDate(iso?: string | null): string {
  if (!iso?.trim()) return "—";
  const d = parseISO(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (!isValid(d)) return iso.slice(0, 10);
  return format(d, "d MMM yyyy");
}

const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;

function splitAddressAndPostcode(
  address?: string | null,
  postcode?: string | null,
): { street: string; outward: string } {
  const pc = postcode?.trim() ?? "";
  const raw = (address ?? "").trim();
  if (pc) {
    const street = raw.replace(UK_POSTCODE_RE, "").replace(/,\s*$/, "").trim() || raw || "—";
    return { street: street || "—", outward: pc };
  }
  const match = raw.match(UK_POSTCODE_RE);
  if (match) {
    const outward = match[1].toUpperCase().replace(/\s+/g, " ");
    const street = raw.replace(match[0], "").replace(/,\s*$/, "").trim();
    return { street: street || raw, outward };
  }
  return { street: raw || "—", outward: "—" };
}

function replaceAll(template: string, key: string, value: string): string {
  return template.split(`{{${key}}}`).join(value);
}

function buildPaymentReceivedBanner(total: string, paymentDate: string): string {
  return `
          <tr>
            <td bgcolor="#DCFCE7" style="background:#DCFCE7; padding:18px 40px; border-bottom:3px solid #22C55E;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="middle" width="36" style="padding-right:12px;">
                    <span style="display:inline-block; width:30px; height:30px; line-height:30px; background:#22C55E; color:#fff; border-radius:50%; text-align:center; font-size:18px; font-weight:700;">✓</span>
                  </td>
                  <td valign="middle">
                    <p style="margin:0; padding:0; font-size:11px; font-weight:700; letter-spacing:2px; color:#166534; text-transform:uppercase;">
                      PAYMENT RECEIVED
                    </p>
                    <p style="margin:2px 0 0 0; padding:0; font-size:14px; color:#166534;">
                      £${escapeHtml(total)} on ${escapeHtml(paymentDate)}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

function buildPaymentDueBanner(amountDue: string, dueDate: string): string {
  return `
          <tr>
            <td bgcolor="#FFF1EA" style="background:#FFF1EA; padding:18px 40px; border-bottom:3px solid #ED4B00;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="middle" width="36" style="padding-right:12px;">
                    <span style="display:inline-block; width:30px; height:30px; line-height:30px; background:#ED4B00; color:#fff; border-radius:50%; text-align:center; font-size:16px; font-weight:700;">!</span>
                  </td>
                  <td valign="middle">
                    <p style="margin:0; padding:0; font-size:11px; font-weight:700; letter-spacing:2px; color:#9A3412; text-transform:uppercase;">
                      PAYMENT DUE
                    </p>
                    <p style="margin:2px 0 0 0; padding:0; font-size:14px; color:#9A3412;">
                      £${escapeHtml(amountDue)} due by ${escapeHtml(dueDate)}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

function buildPaymentMethodBlock(method: string, transactionId: string): string {
  return `
          <tr>
            <td class="px" style="padding:0 40px 28px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F7FA; border-radius:6px;">
                <tr>
                  <td style="padding:10px 16px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td valign="middle" style="font-size:11px; font-weight:700; letter-spacing:1px; color:#9A9AA8; text-transform:uppercase;">Method</td>
                        <td valign="middle" align="right" style="font-size:13px; color:#020040; font-weight:600;">${escapeHtml(method)}</td>
                      </tr>
                      <tr>
                        <td valign="middle" style="padding-top:4px; font-size:11px; font-weight:700; letter-spacing:1px; color:#9A9AA8; text-transform:uppercase;">Transaction</td>
                        <td valign="middle" align="right" style="padding-top:4px; font-size:12px; color:#4A4A55; font-family:monospace;">${escapeHtml(transactionId)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

function buildPayNowBlock(paymentLinkUrl: string): string {
  return `
          <tr>
            <td class="px" style="padding:0 40px 28px 40px; text-align:center;">
              <a href="${escapeHtml(paymentLinkUrl)}" style="display:inline-block;background:#020040;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:14px 32px;border-radius:8px;">Pay now</a>
              <p style="margin:10px 0 0 0; font-size:12px; color:#9A9AA8;">Secure payment via Stripe</p>
            </td>
          </tr>`;
}

/**
 * GetFixfy LTD bank details — shown on unpaid invoices so the client can pay
 * by bank transfer as an alternative to the Stripe link. Hidden on paid
 * receipts (no need to repeat).
 */
function buildBankDetailsBlock(heading = "Or pay by bank transfer"): string {
  const rowsHtml = FIXFY_CLIENT_BANK_DETAIL_ROWS
    .map(
      (r) => `
                      <tr>
                        <td valign="middle" style="padding-top:4px; font-size:11px; font-weight:700; letter-spacing:1px; color:#9A9AA8; text-transform:uppercase;">${escapeHtml(r.label)}</td>
                        <td valign="middle" align="right" style="padding-top:4px; font-size:13px; color:#020040; font-family:monospace;">${escapeHtml(r.value)}</td>
                      </tr>`,
    )
    .join("");

  return `
          <tr>
            <td class="px" style="padding:0 40px 28px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F7FA; border-radius:6px;">
                <tr>
                  <td style="padding:14px 18px;">
                    <p style="margin:0 0 8px 0; padding:0; font-size:10px; font-weight:700; letter-spacing:2px; color:#9A9AA8; text-transform:uppercase;">${escapeHtml(heading)}</p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml}
                    </table>
                    <p style="margin:10px 0 0 0; padding:0; font-size:11px; line-height:16px; color:#9A9AA8;">Use the statement reference as the payment reference so we can match it automatically.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

function buildReportNoticeBlock(count: number): string {
  const label = count === 1 ? "report" : "reports";
  return `
          <tr>
            <td class="px" style="padding:16px 40px 0 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEF2FF; border-radius:8px;">
                <tr>
                  <td style="padding:12px 16px;">
                    <p style="margin:0; font-size:13px; line-height:20px; color:#020040;">
                      Your final ${label} ${count === 1 ? "is" : "are"} attached to this email.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}


/** Uma linha da tabela de valores do recibo de agente. */
function agentChargeRow(label: string, amount: string, sub?: string, muted = false): string {
  const subHtml = sub
    ? `
                          <p style="margin:2px 0 0 0; font-size:11px; color:#9A9AA8;">${escapeHtml(sub)}</p>`
    : "";
  return `
                <tr>
                  <td style="padding:14px 20px; border-bottom:1px solid #F2F0FA;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td valign="middle">
                          <p style="margin:0; font-size:14px; color:${muted ? "#4A4A55" : "#1A1A1A"};">${escapeHtml(label)}</p>${subHtml}
                        </td>
                        <td valign="middle" align="right" style="font-size:14px; color:#020040; font-weight:600;">${amount}</td>
                      </tr>
                    </table>
                  </td>
                </tr>`;
}

/**
 * Schedule A: serviços pelo preço do profissional, VAT DELE (ou "No VAT
 * charged"), promoção da Fixfy em linha própria. Nada de "platform fee".
 */
function buildAgentChargesRows(view: AgentReceiptView, paid: boolean): string {
  const rows: string[] = view.lines.map((l) => agentChargeRow(l.label, `£${formatMoneyPlain(l.amount)}`));
  if (view.lines.length > 1 || view.vatLine || view.promotion > 0.02) {
    rows.push(
      agentChargeRow(
        view.professionalName ? `${view.professionalName}'s price` : "Price",
        `£${formatMoneyPlain(view.professionalPrice)}`,
      ),
    );
  }
  if (view.vatLine) {
    rows.push(
      agentChargeRow(
        view.vatLine,
        view.vatAmount != null ? `£${formatMoneyPlain(view.vatAmount)}` : "",
        view.vatNumber ? `VAT number ${view.vatNumber}` : undefined,
        true,
      ),
    );
  }
  if (view.promotion > 0.02) {
    rows.push(agentChargeRow("Fixfy promotion, paid by Fixfy on your behalf", `-£${formatMoneyPlain(view.promotion)}`));
  }
  if (view.partOfPrice) {
    rows.push(
      agentChargeRow(paid ? "This receipt covers" : "This statement covers", `£${formatMoneyPlain(view.documentAmount)}`),
    );
  }
  return rows.join("");
}

/** Schedule A: o bloco "Your professional" (04-booking-copy, e-mail C2). */
function buildProfessionalBlock(view: AgentReceiptView): string {
  const name = view.professionalName;
  const lines: string[] = [];
  lines.push(
    name
      ? "Independent trader: they offer their services as a business, and your contract for this job is with them."
      : "Your job is carried out by an independent, vetted professional, named in your booking confirmation.",
  );
  if (name && view.businessAddress) lines.push(`Business address: ${view.businessAddress}`);
  if (name) {
    lines.push(
      view.vatNumber
        ? `VAT: VAT registered, VAT number ${view.vatNumber}`
        : "VAT: Not VAT registered, so no VAT is charged",
    );
  }
  const body = lines
    .map((l) => `<p style="margin:4px 0 0 0; font-size:13px; line-height:19px; color:#4A4A55;">${escapeHtml(l)}</p>`)
    .join("");
  return `
          <tr>
            <td class="px" style="padding:0 40px 8px 40px;">
              <p style="margin:0 0 12px 0; padding:0; font-size:11px; font-weight:700; letter-spacing:2px; color:#020040; text-transform:uppercase;">
                YOUR PROFESSIONAL
              </p>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:0 40px 24px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E8E8EE; border-radius:8px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0; font-size:16px; font-weight:700; color:#020040; line-height:22px;">${escapeHtml(name ?? "Your professional")}</p>
                    ${body}
                    <p style="margin:8px 0 0 0; font-size:12px; line-height:18px; color:#9A9AA8;">${escapeHtml(view.issuerLine)}.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

/** Schedule A: no lugar do "Need a VAT invoice?", quem é quem e quem recebeu o pagamento. */
function buildAgentNoticeBlock(view: AgentReceiptView): string {
  return `
          <tr>
            <td class="px" style="padding:0 40px 24px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFF1EA; border-left:4px solid #ED4B00; border-radius:0 6px 6px 0;">
                <tr>
                  <td style="padding:14px 18px;">
                    <p style="margin:0 0 6px 0; padding:0; font-size:10px; font-weight:700; letter-spacing:2px; color:#ED4B00; text-transform:uppercase;">
                      Who you are booking with
                    </p>
                    <p style="margin:0 0 6px 0; padding:0; font-size:13px; line-height:19px; color:#020040;">${escapeHtml(view.paymentNote)}</p>
                    <p style="margin:0; padding:0; font-size:13px; line-height:19px; color:#020040;">${escapeHtml(view.bookingNote)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

function resolvePaymentMethod(inv: Invoice): string {
  if (inv.stripe_paid_at || inv.stripe_payment_status === "paid") return "Card (Stripe)";
  if (inv.stripe_payment_link_url) return "Card (Stripe)";
  return "Bank transfer";
}

function resolveTransactionId(inv: Invoice): string {
  const pi = inv.stripe_payment_intent_id?.trim();
  if (pi) return pi;
  return inv.reference?.trim() || "—";
}

/**
 * Fixfy client invoice / payment receipt email (HTML body).
 * Green "Payment received" banner only when payment is verified; otherwise shows invoice with payment due.
 */
export function buildInvoiceClientEmailHTML(
  invoice: Invoice,
  context: InvoiceClientEmailContext,
  job?: InvoiceTradeFeeJob | null,
  options?: InvoiceEmailOptions,
): string {
  const paid = isInvoicePaymentVerified(invoice);
  const invAmt = Math.max(0, Math.round((Number(invoice.amount ?? 0) || 0) * 100) / 100);
  const paidAmt = Math.round(invoiceAmountPaid(invoice) * 100) / 100;
  const balanceDue = invoiceBalanceDue(invoice);
  const fullDue = balanceDue > 0.02 ? balanceDue : invAmt;
  const amountDueNow =
    !paid && options?.amountDueNow != null && options.amountDueNow > 0
      ? Math.round(options.amountDueNow * 100) / 100
      : fullDue;
  const isPartialRequest =
    !paid &&
    options?.amountDueNow != null &&
    options.amountDueNow > 0.02 &&
    Math.abs(amountDueNow - fullDue) > 0.02;
  const partial = !paid && paidAmt > 0.02;
  // Schedule A (modelo de agente): recibo em nome do profissional; ausente = B.
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
  const { street, outward } = splitAddressAndPostcode(context.propertyAddress, context.postcode);
  const quoteRef = context.quoteReference?.trim()
    ? refForTemplate(context.quoteReference, "QT")
    : "—";
  const billingRefDisplay = displayBillingReference(invoice.reference);
  const issueDate = formatDisplayDate(invoice.created_at);
  const dueDate = formatDisplayDate(invoice.due_date);
  const paymentDate = formatDisplayDate(
    invoice.stripe_paid_at ?? invoice.paid_date ?? invoice.last_payment_date,
  );
  const completionDate = formatDisplayDate(context.completionDate);

  let html = loadInvoiceClientTemplate();

  const statusBanner = paid
    ? buildPaymentReceivedBanner(formatMoneyPlain(invAmt), paymentDate)
    : buildPaymentDueBanner(formatMoneyPlain(amountDueNow), dueDate);

  const reportCount = options?.reportAttachmentCount ?? 0;
  const missingReport = options?.missingReportNote?.trim() ?? "";
  const reportNotice =
    (reportCount > 0 ? buildReportNoticeBlock(reportCount) : "") +
    (missingReport
      ? `
          <tr>
            <td class="px" style="padding:16px 40px 0 40px;">
              <p style="margin:0; font-size:13px; line-height:20px; color:#B45309;">${escapeHtml(missingReport)}</p>
            </td>
          </tr>`
      : "");

  const documentEyebrow = agentView
    ? paid
      ? agentView.professionalName
        ? `RECEIPT FROM ${agentView.professionalName.toUpperCase()}`
        : "PAYMENT RECEIVED"
      : "STATEMENT OF CHARGES"
    : paid
      ? "PAYMENT RECEIPT"
      : "STATEMENT OF CHARGES";
  const pageTitle = agentView ? (paid ? "Receipt" : "Statement of Charges") : paid ? "Payment Receipt" : "Statement of Charges";
  const refLabel = paid ? (agentView ? "Receipt No." : "Receipt Ref") : "Statement Ref";
  const refValue = escapeHtml(billingRefDisplay);

  const agentIntro = agentView
    ? paid
      ? `We've received your payment for the work below, on behalf of ${agentView.professionalLabel}. This receipt is issued in their name.`
      : partial
        ? `We've received a partial payment on behalf of ${agentView.professionalLabel}. The remaining balance is shown below.`
        : `Your job is complete. Below is the statement for the work carried out by ${agentView.professionalLabel}. Payment details are included.`
    : null;
  const intro = options?.customMessage?.trim()
    ? escapeHtml(options.customMessage.trim())
    : agentIntro
      ? escapeHtml(agentIntro)
      : paid
        ? PAID_INTRO
        : partial
          ? PARTIAL_INTRO
          : UNPAID_INTRO;

  const dueDateRow = paid
    ? ""
    : `<tr>
                        <td valign="middle" style="padding-top:6px; font-size:11px; font-weight:700; letter-spacing:1.5px; color:#9A9AA8; text-transform:uppercase;">Due date</td>
                        <td valign="middle" align="right" style="padding-top:6px; font-size:13px; color:#020040;">${escapeHtml(dueDate)}</td>
                      </tr>`;

  const amountPaidRow = partial
    ? `<tr>
                  <td style="padding:14px 20px; border-bottom:1px solid #F2F0FA;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td valign="middle">
                          <p style="margin:0; font-size:14px; color:#1A1A1A;">Already paid</p>
                        </td>
                        <td valign="middle" align="right" style="font-size:14px; color:#0F6E56; font-weight:600;">£${formatMoneyPlain(paidAmt)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>`
    : "";

  const breakdownTotalLabel = paid
    ? "Total paid"
    : isPartialRequest
      ? "Amount due now"
      : partial
        ? "Balance due"
        : "Total due";
  const breakdownTotalAmount = paid ? formatMoneyPlain(invAmt) : formatMoneyPlain(amountDueNow);

  const paymentMethodBlock = paid
    ? buildPaymentMethodBlock(resolvePaymentMethod(invoice), resolveTransactionId(invoice))
    : "";

  const payLinkBase = paid ? "" : invoicePayLinkForClient(invoice.reference, invoice.stripe_payment_link_url);
  // Partial requests charge the requested % through the OS /pay link; legacy
  // fixed Stripe Payment Links can't vary the amount, so they keep the full link.
  const requestPct = Math.round(Number(options?.requestPercent ?? 0));
  const payLink =
    payLinkBase && isPartialRequest && payLinkBase.includes("/pay/") && requestPct >= 1 && requestPct <= 99
      ? `${payLinkBase.split("?")[0]}?pct=${requestPct}`
      : payLinkBase;
  const payNowBlock = payLink ? buildPayNowBlock(payLink) : "";
  const bankDetailsBlock = paid
    ? ""
    : agentView
      ? buildBankDetailsBlock(`Or pay by bank transfer to Fixfy, as agent for ${agentView.professionalLabel}`)
      : buildBankDetailsBlock();

  /**
   * O texto de quem vende, alinhado aos termos de 06/10/2026.
   *
   * Schedule A: a Fixfy é agente do profissional, que é com quem o cliente
   * contratou, e recebe o pagamento em nome dele.
   * Schedule B: venda da própria Getfixfy Ltd (principal). Nada de "plataforma
   * divulgada" nem de agente: em B a Fixfy é quem vende o serviço.
   */
  const vatPrimary = agentView
    ? agentView.bookingNote
    : paid
      ? "This receipt confirms your full payment to Getfixfy Ltd for the work below."
      : "This statement from Getfixfy Ltd covers the work completed below.";

  const preheader = agentView
    ? paid
      ? `Payment received: £${formatMoneyPlain(invAmt)} for ${context.jobTitle}. Receipt ${billingRefDisplay}, issued for ${agentView.professionalLabel}.`
      : `Statement ${billingRefDisplay}: £${formatMoneyPlain(isPartialRequest ? amountDueNow : invAmt)} due for ${context.jobTitle}, work by ${agentView.professionalLabel}.`
    : paid
    ? `Payment received — £${formatMoneyPlain(invAmt)} for ${context.jobTitle}. Receipt ${billingRefDisplay}.`
    : isPartialRequest
      ? `Statement ${billingRefDisplay} — £${formatMoneyPlain(amountDueNow)} requested (${options?.requestPercent ?? 0}% of £${formatMoneyPlain(fullDue)}) for ${context.jobTitle}.`
      : `Statement ${billingRefDisplay} — £${formatMoneyPlain(invAmt)} due for ${context.jobTitle}.`;

  html = replaceAll(html, "page_title", escapeHtml(pageTitle));
  html = replaceAll(html, "preheader", escapeHtml(preheader));
  html = replaceAll(html, "status_banner", statusBanner);
  html = replaceAll(html, "report_notice_block", reportNotice);
  html = replaceAll(html, "document_eyebrow", documentEyebrow);
  html = replaceAll(html, "client_first_name", escapeHtml(clientFirstName(context.clientName)));
  html = replaceAll(html, "intro_message", intro);
  html = replaceAll(html, "ref_label", refLabel);
  html = replaceAll(html, "ref_value", refValue);
  html = replaceAll(html, "issue_date", escapeHtml(issueDate));
  html = replaceAll(html, "due_date_row", dueDateRow);
  html = replaceAll(html, "quote_reference", escapeHtml(quoteRef));
  html = replaceAll(html, "job_title", escapeHtml(context.jobTitle || "Job"));
  html = replaceAll(
    html,
    "type_of_work",
    escapeHtml(context.serviceType?.trim() || context.jobTitle || "Property services"),
  );
  html = replaceAll(html, "property_address", escapeHtml(street));
  html = replaceAll(html, "property_postcode", escapeHtml(outward));
  html = replaceAll(html, "completion_date", escapeHtml(completionDate));
  html = replaceAll(html, "professional_block", agentView ? buildProfessionalBlock(agentView) : "");
  html = replaceAll(html, "job_section_label", agentView ? "JOB" : "JOB COMPLETED");
  html = replaceAll(html, "breakdown_section_label", agentView ? "SERVICES" : "PAYMENT BREAKDOWN");
  html = replaceAll(html, "charges_rows", agentView ? buildAgentChargesRows(agentView, paid) : B_CHARGES_ROWS);
  html = replaceAll(html, "vat_box_block", agentView ? buildAgentNoticeBlock(agentView) : B_VAT_BOX);
  html = replaceAll(html, "trade_amount", formatMoneyPlain(trade));
  html = replaceAll(html, "fixfy_fee", formatMoneyPlain(fee));
  html = replaceAll(html, "amount_paid_row", amountPaidRow);
  html = replaceAll(html, "breakdown_total_label", breakdownTotalLabel);
  html = replaceAll(html, "breakdown_total_amount", breakdownTotalAmount);
  html = replaceAll(html, "payment_method_block", paymentMethodBlock);
  html = replaceAll(html, "pay_now_block", payNowBlock);
  html = replaceAll(html, "bank_details_block", bankDetailsBlock);
  html = replaceAll(html, "vat_disclaimer_primary", escapeHtml(vatPrimary));
  html = replaceAll(html, "total_amount", formatMoneyPlain(invAmt));

  return html;
}
