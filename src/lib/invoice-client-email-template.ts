import "server-only";
import { readFileSync } from "fs";
import { join } from "path";
import { format, parseISO, isValid } from "date-fns";
import type { Invoice } from "@/types/database";
import type { Job } from "@/types/database";
import { invoiceAmountPaid, invoiceBalanceDue } from "@/lib/invoice-balance";
import { isInvoicePaymentVerified } from "@/lib/invoice-payment-verified";
import { partnerSelfBillGrossAmount } from "@/lib/job-financials";
import { displayBillingReference } from "@/lib/billing-reference";

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
};

const PAID_INTRO =
  "We've received your payment for the work below. Thanks for choosing Fixfy.";
const UNPAID_INTRO =
  "Your job is complete. Please find your statement of charges below — payment details are included.";
const PARTIAL_INTRO =
  "We've received a partial payment. The remaining balance is shown below.";

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

function splitTradeAndFee(
  chargedAmount: number,
  job?: Pick<Job, "partner_agreed_value" | "partner_cost" | "materials_cost"> | null,
): { trade: number; fee: number } {
  const total = Math.max(0, Math.round(chargedAmount * 100) / 100);
  if (!job || total <= 0) {
    return { trade: total, fee: 0 };
  }
  const partnerGross = Math.round(partnerSelfBillGrossAmount(job) * 100) / 100;
  const trade = Math.max(0, Math.min(total, partnerGross));
  const fee = Math.max(0, Math.round((total - trade) * 100) / 100);
  return { trade, fee };
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
function buildBankDetailsBlock(): string {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Account name", value: "GETFIXFY LTD" },
    { label: "Sort code",    value: "04-00-03" },
    { label: "Account no.",  value: "06913415" },
    { label: "IBAN",         value: "GB38 MONZ 0400 0306 9134 15" },
    { label: "Bank",         value: "Monzo Bank" },
  ];
  const rowsHtml = rows
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
                    <p style="margin:0 0 8px 0; padding:0; font-size:10px; font-weight:700; letter-spacing:2px; color:#9A9AA8; text-transform:uppercase;">Or pay by bank transfer</p>
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
  job?: Pick<Job, "partner_agreed_value" | "partner_cost" | "materials_cost"> | null,
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
  const { trade, fee } = splitTradeAndFee(invAmt, job);
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

  const documentEyebrow = paid ? "PAYMENT RECEIPT" : "STATEMENT OF CHARGES";
  const pageTitle = paid ? "Payment Receipt" : "Statement of Charges";
  const refLabel = paid ? "Receipt Ref" : "Statement Ref";
  const refValue = escapeHtml(billingRefDisplay);

  const intro = options?.customMessage?.trim()
    ? escapeHtml(options.customMessage.trim())
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

  const payLink = !paid && invoice.stripe_payment_link_url?.trim()
    ? invoice.stripe_payment_link_url.trim()
    : "";
  const payNowBlock = payLink ? buildPayNowBlock(payLink) : "";
  const bankDetailsBlock = paid ? "" : buildBankDetailsBlock();

  const vatPrimary = paid
    ? "Fixfy operates as a disclosed platform connecting clients with independent trade providers. This receipt confirms your full payment."
    : "Fixfy operates as a disclosed platform connecting clients with independent trade providers. This statement covers the work completed below.";

  const preheader = paid
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
