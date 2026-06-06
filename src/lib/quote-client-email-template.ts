import { readFileSync } from "fs";
import { join } from "path";
import { addDays, format, parseISO, isValid } from "date-fns";
import type { QuotePDFData, CompanyBranding, QuoteLineItem } from "@/lib/pdf/quote-template";
export type QuoteClientEmailContext = {
  propertyAddress?: string | null;
  postcode?: string | null;
  serviceType?: string | null;
};

export interface QuoteEmailOptions {
  acceptUrl?: string;
  rejectUrl?: string;
  customMessage?: string;
  context?: QuoteClientEmailContext;
}

const DEFAULT_INTRO =
  "Thanks for the request. Please find your quote below. To accept, simply reply to this email confirming and we'll schedule the work.";

let cachedTemplate: string | null = null;

function loadQuoteClientTemplate(): string {
  if (cachedTemplate) return cachedTemplate;
  cachedTemplate = readFileSync(
    join(process.cwd(), "src/lib/email-templates/quote-client.html"),
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

function quoteRefForTemplate(reference: string): string {
  return reference.replace(/^QT-/i, "").trim() || reference;
}

function formatValidUntil(createdAt: string, expiresAt?: string): string {
  if (expiresAt?.trim()) {
    const d = parseISO(expiresAt);
    if (isValid(d)) {
      return format(d, "d MMM yyyy");
    }
  }
  const created = parseISO(createdAt);
  if (isValid(created)) {
    return format(addDays(created, 14), "d MMM yyyy");
  }
  return "—";
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

/** OS quotes: line 0 = labour, line 1+ = materials (inc VAT totals). */
export function splitQuoteLabourMaterials(
  items: QuoteLineItem[] | undefined,
  totalValue: number,
): { labour: number; materials: number } {
  const rows = items?.filter((r) => Number(r.total) > 0) ?? [];
  if (rows.length === 0) {
    return { labour: totalValue, materials: 0 };
  }
  if (rows.length === 1) {
    return { labour: Number(rows[0]!.total) || totalValue, materials: 0 };
  }
  const labour = Number(rows[0]!.total) || 0;
  const materials = rows.slice(1).reduce((s, r) => s + (Number(r.total) || 0), 0);
  const sum = labour + materials;
  if (sum > 0.01 && Math.abs(sum - totalValue) > 0.05) {
    return { labour: totalValue - materials, materials };
  }
  return { labour, materials };
}

function buildAcceptRejectBlock(acceptUrl?: string, rejectUrl?: string): string {
  if (!acceptUrl || !rejectUrl) return "";
  return `
          <tr>
            <td class="px" style="padding:0 40px 20px 40px; text-align:center;">
              <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="padding:0 8px 0 0;">
                    <a href="${escapeHtml(acceptUrl)}" style="display:inline-block;background:#16A34A;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;">Accept quote</a>
                  </td>
                  <td>
                    <a href="${escapeHtml(rejectUrl)}" style="display:inline-block;background:#DC2626;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;">Decline</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

function replaceAll(template: string, key: string, value: string): string {
  return template.split(`{{${key}}}`).join(value);
}

/**
 * Fixfy client quote email (HTML body) — used by send-pdf and email-preview.
 * PDF attachment remains the react-pdf quote; invoice template is separate.
 */
export function buildQuoteClientEmailHTML(
  data: QuotePDFData,
  _branding: CompanyBranding,
  options?: QuoteEmailOptions,
  context?: QuoteClientEmailContext,
): string {
  const { acceptUrl, rejectUrl, customMessage } = options ?? {};
  const items =
    data.items?.length
      ? data.items
      : [{ description: data.title || "Services", quantity: 1, unitPrice: data.totalValue, total: data.totalValue }];
  const { labour, materials } = splitQuoteLabourMaterials(items, Number(data.totalValue) || 0);
  const { street, outward } = splitAddressAndPostcode(context?.propertyAddress, context?.postcode);
  const scope =
    typeof data.scope === "string" && data.scope.trim()
      ? escapeHtml(data.scope.trim())
      : escapeHtml(data.title || "As discussed");

  let html = loadQuoteClientTemplate();
  const intro = customMessage?.trim()
    ? escapeHtml(customMessage.trim())
    : DEFAULT_INTRO;

  html = replaceAll(html, "client_first_name", escapeHtml(clientFirstName(data.clientName)));
  html = replaceAll(html, "job_title", escapeHtml(data.title || "Quote"));
  html = replaceAll(html, "total_amount", formatMoneyPlain(Number(data.totalValue) || 0));
  html = replaceAll(html, "quote_reference", escapeHtml(quoteRefForTemplate(data.reference)));
  html = replaceAll(html, "valid_until", escapeHtml(formatValidUntil(data.createdAt, data.expiresAt)));
  html = replaceAll(
    html,
    "type_of_work",
    escapeHtml(context?.serviceType?.trim() || data.title || "Property services"),
  );
  html = replaceAll(html, "property_address", escapeHtml(street));
  html = replaceAll(html, "property_postcode", escapeHtml(outward));
  html = replaceAll(html, "scope", scope);
  html = replaceAll(html, "labour_amount", formatMoneyPlain(labour));
  html = replaceAll(html, "materials_amount", formatMoneyPlain(materials));
  html = replaceAll(html, "intro_message", intro);
  html = replaceAll(html, "accept_reject_block", buildAcceptRejectBlock(acceptUrl, rejectUrl));

  return html;
}
