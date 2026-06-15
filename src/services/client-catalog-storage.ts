import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import {
  buildClientCatalogPayload,
  type ClientCatalogPayload,
} from "@/lib/client-catalog-payload";
import { renderClientCatalogHtml } from "@/lib/client-catalog-html";
import { ClientCatalogPDF } from "@/lib/pdf/client-catalog-template";
import { appBaseUrl } from "@/lib/app-base-url";
import { createServiceClient } from "@/lib/supabase/service";

const BUCKET = "company-assets";
const HTML_PATH = "catalog/latest.html";
const PDF_PATH = "catalog/latest.pdf";
const JSON_PATH = "catalog/latest.json";

export type ClientCatalogPublishResult = {
  liveUrl: string;
  htmlUrl: string | null;
  pdfUrl: string | null;
  publishedAt: string;
  totalActive: number;
  /** Non-fatal upload issues (e.g. bucket MIME allowlist — run migration 240). */
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

export async function renderClientCatalogPdfBuffer(
  payload: ClientCatalogPayload,
): Promise<Buffer> {
  const buf = await renderToBuffer(
    React.createElement(ClientCatalogPDF, { payload }) as Parameters<typeof renderToBuffer>[0],
  );
  return Buffer.from(buf);
}

/** Build HTML + PDF snapshots and upload to public company-assets bucket. */
export async function publishClientCatalogSnapshot(): Promise<ClientCatalogPublishResult> {
  const payload = await buildClientCatalogPayload();
  const html = renderClientCatalogHtml(payload);
  const pdf = await renderClientCatalogPdfBuffer(payload);
  const json = JSON.stringify(payload);

  const [htmlResult, pdfResult, jsonResult] = await Promise.all([
    tryUpload("HTML", HTML_PATH, Buffer.from(html, "utf8"), "text/html", "application/octet-stream"),
    tryUpload("PDF", PDF_PATH, pdf, "application/pdf"),
    tryUpload("JSON", JSON_PATH, Buffer.from(json, "utf8"), "application/json", "application/octet-stream"),
  ]);

  const warnings = [htmlResult.warning, pdfResult.warning, jsonResult.warning].filter(
    (w): w is string => Boolean(w),
  );
  if (warnings.length > 0) {
    warnings.push(
      "Apply supabase/migrations/240_company_assets_catalog_mime_types.sql to enable public HTML/PDF links.",
    );
  }

  return {
    liveUrl: `${appBaseUrl()}/catalog`,
    htmlUrl: htmlResult.url,
    pdfUrl: pdfResult.url,
    publishedAt: payload.generatedAt,
    totalActive: payload.totalActive,
    warnings,
  };
}

export async function getPublishedCatalogPdfBuffer(): Promise<Buffer> {
  const payload = await buildClientCatalogPayload();
  return renderClientCatalogPdfBuffer(payload);
}
