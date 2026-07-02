import fs from "fs";
import path from "path";
import { parseFrontendSetup, resolveInvoiceStatementLogoUrl } from "@/lib/frontend-setup";
import type { SupabaseClient } from "@supabase/supabase-js";

const LOGO_FETCH_TIMEOUT_MS = 4000;
const logoDataUriCache = new Map<string, string | undefined>();

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Prefetch a remote logo for @react-pdf/renderer (needs data URI or absolute https). */
export async function resolveLogoDataUri(logoUrl: string | undefined): Promise<string | undefined> {
  if (!logoUrl?.trim() || !isHttpsUrl(logoUrl)) return undefined;
  const key = logoUrl.trim();
  if (logoDataUriCache.has(key)) return logoDataUriCache.get(key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(key, { signal: controller.signal });
    if (!r.ok) {
      logoDataUriCache.set(key, undefined);
      return undefined;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 4 * 1024 * 1024) {
      logoDataUriCache.set(key, undefined);
      return undefined;
    }
    const ct = (r.headers.get("content-type") || "image/png").split(";")[0].trim() || "image/png";
    const dataUri = `data:${ct};base64,${buf.toString("base64")}`;
    logoDataUriCache.set(key, dataUri);
    return dataUri;
  } catch {
    logoDataUriCache.set(key, undefined);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export const DEFAULT_INVOICE_PDF_LOGO_URL = "https://www.getfixfy.com/brand/fixfy-primary-white.png";
const DEFAULT_LOCAL_HEADER_LOGO = "logos/fixfy-wordmark-white-trim.png";

/** Read a logo from `public/` for @react-pdf when remote fetch is unavailable. */
export function readPublicLogoDataUri(relativePath: string): string | undefined {
  try {
    const filePath = path.join(process.cwd(), "public", relativePath.replace(/^\//, ""));
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const ct =
      ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}

/** Company logo for PDF headers (Setup → Finance override, then company logo, then Fixfy default). */
export async function resolveCompanyPdfLogoDataUri(
  supabase: SupabaseClient,
): Promise<string | undefined> {
  const { data: company } = await supabase
    .from("company_settings")
    .select("logo_url, frontend_setup")
    .limit(1)
    .maybeSingle();
  const companyRow = company as { logo_url?: string | null; frontend_setup?: unknown } | null;
  const setup = parseFrontendSetup(companyRow?.frontend_setup);
  const logoSource =
    resolveInvoiceStatementLogoUrl(setup, companyRow?.logo_url) || DEFAULT_INVOICE_PDF_LOGO_URL;
  return (
    (await resolveLogoDataUri(logoSource)) ??
    readPublicLogoDataUri(DEFAULT_LOCAL_HEADER_LOGO)
  );
}
