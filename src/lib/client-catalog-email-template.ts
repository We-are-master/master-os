import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ClientCatalogEmailInput = {
  recipientName?: string;
  message?: string;
  liveUrl: string;
  pdfUrl: string;
  companyName: string;
  logoUrl: string;
};

const DEFAULT_LOGO = "https://www.getfixfy.com/brand/fixfy-primary-white.png";

let cachedTemplate: string | null = null;

function loadTemplate(): string {
  if (cachedTemplate) return cachedTemplate;
  const path = join(process.cwd(), "src/lib/email-templates/client-catalog-share.html");
  cachedTemplate = readFileSync(path, "utf8");
  return cachedTemplate;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildClientCatalogEmailHTML(input: ClientCatalogEmailInput): string {
  const tpl = loadTemplate();
  const greeting = input.recipientName?.trim()
    ? ` ${esc(input.recipientName.trim())}`
    : "";
  const messageBlock = input.message?.trim()
    ? `<p style="margin:0 0 16px; font-size:15px; line-height:24px; color:#020040; background:#FFF8F4; border-left:4px solid #ED4B00; padding:12px 14px;">${esc(input.message.trim()).replace(/\n/g, "<br>")}</p>`
    : "";

  const pdfLinkBlock = input.pdfUrl?.trim()
    ? `<p style="margin:0 0 8px; font-size:14px; line-height:22px; color:#57534E;">
                Direct PDF link: <a href="${esc(input.pdfUrl.trim())}" style="color:#ED4B00; font-weight:600;">Download PDF</a>
              </p>`
    : `<p style="margin:0 0 8px; font-size:14px; line-height:22px; color:#57534E;">
                The rate card PDF is attached to this email.
              </p>`;

  return tpl
    .replace(/\{\{logo_url\}\}/g, esc(input.logoUrl || DEFAULT_LOGO))
    .replace(/\{\{recipient_greeting\}\}/g, greeting)
    .replace(/\{\{message_block\}\}/g, messageBlock)
    .replace(/\{\{live_url\}\}/g, esc(input.liveUrl))
    .replace(/\{\{pdf_link_block\}\}/g, pdfLinkBlock)
    .replace(/\{\{company_name\}\}/g, esc(input.companyName || "Fixfy"));
}
