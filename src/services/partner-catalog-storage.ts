import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { buildPartnerCatalogPayload } from "@/lib/partner-catalog-payload";
import type { CatalogRateCardPayload } from "@/lib/catalog-rate-card-core";
import { renderPartnerCatalogHtml } from "@/lib/partner-catalog-html";
import { PartnerCatalogPDF } from "@/lib/pdf/partner-catalog-template";
import { appBaseUrl } from "@/lib/app-base-url";
import { createServiceClient } from "@/lib/supabase/service";

const BUCKET = "company-assets";
const HTML_PATH = "catalog/partner/latest.html";
const PDF_PATH = "catalog/partner/latest.pdf";
const JSON_PATH = "catalog/partner/latest.json";

export type PartnerCatalogPublishResult = {
  liveUrl: string;
  htmlUrl: string | null;
  pdfUrl: string | null;
  publishedAt: string;
  totalActive: number;
  warnings: string[];
};

function publicUrl(path: string): string {
  const supabase = createServiceClient();
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function uploadBuffer(
  path: string,
  body: Buffer | Uint8Array,
  contentType: string,
  fallbackContentType?: string,
): Promise<string> {
  const supabase = createServiceClient();
  let { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    upsert: true,
    contentType,
    cacheControl: "300",
  });
  if (error && fallbackContentType && fallbackContentType !== contentType) {
    ({ error } = await supabase.storage.from(BUCKET).upload(path, body, {
      upsert: true,
      contentType: fallbackContentType,
      cacheControl: "300",
    }));
  }
  if (error) throw new Error(error.message);
  return publicUrl(path);
}

async function tryUpload(
  label: string,
  path: string,
  body: Buffer | Uint8Array,
  contentType: string,
  fallbackContentType?: string,
): Promise<{ url: string | null; warning: string | null }> {
  try {
    const url = await uploadBuffer(path, body, contentType, fallbackContentType);
    return { url, warning: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { url: null, warning: `${label}: ${msg}` };
  }
}

export async function renderPartnerCatalogPdfBuffer(
  payload: CatalogRateCardPayload,
): Promise<Buffer> {
  const buf = await renderToBuffer(
    React.createElement(PartnerCatalogPDF, { payload }) as Parameters<typeof renderToBuffer>[0],
  );
  return Buffer.from(buf);
}

export async function publishPartnerCatalogSnapshot(): Promise<PartnerCatalogPublishResult> {
  const payload = await buildPartnerCatalogPayload();
  const html = renderPartnerCatalogHtml(payload);
  const pdf = await renderPartnerCatalogPdfBuffer(payload);
  const json = JSON.stringify(payload);

  const [htmlResult, pdfResult] = await Promise.all([
    tryUpload("HTML", HTML_PATH, Buffer.from(html, "utf8"), "text/html", "application/octet-stream"),
    tryUpload("PDF", PDF_PATH, pdf, "application/pdf"),
    tryUpload("JSON", JSON_PATH, Buffer.from(json, "utf8"), "application/json", "application/octet-stream"),
  ]);

  const warnings = [htmlResult.warning, pdfResult.warning].filter((w): w is string => Boolean(w));
  if (warnings.length > 0) {
    warnings.push(
      "Apply supabase/migrations/240_company_assets_catalog_mime_types.sql to enable public HTML/PDF links.",
    );
  }

  return {
    liveUrl: `${appBaseUrl()}/catalog/partner`,
    htmlUrl: htmlResult.url,
    pdfUrl: pdfResult.url,
    publishedAt: payload.generatedAt,
    totalActive: payload.totalActive,
    warnings,
  };
}

export async function getPartnerCatalogPdfBuffer(): Promise<Buffer> {
  const payload = await buildPartnerCatalogPayload();
  return renderPartnerCatalogPdfBuffer(payload);
}
