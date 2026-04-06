import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { Resend } from "resend";
import React from "react";
import { QuotePDF, type QuotePDFData, type CompanyBranding } from "@/lib/pdf/quote-template";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createQuoteResponseToken } from "@/lib/quote-response-token";
import { buildQuoteEmailHTML } from "@/lib/quote-email-template";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeJsonImageArray } from "@/lib/request-attachment-images";

function nowMs() {
  return performance.now();
}

function withServerTiming(body: unknown, status: number, marks: Array<[string, number]>) {
  const metric = marks
    .filter(([, v]) => Number.isFinite(v) && v >= 0)
    .map(([k, v]) => `${k};dur=${Math.round(v)}`)
    .join(", ");
  const res = NextResponse.json(body, { status });
  if (metric) res.headers.set("Server-Timing", metric);
  return res;
}

function isHttpsUrl(u: string): boolean {
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
}

/** Fetch public site-photo URLs and build Resend attachment payloads (max 8 MB each). */
async function sitePhotoAttachments(photoUrls: string[]): Promise<{ filename: string; content: Buffer; contentType: string }[]> {
  const out: { filename: string; content: Buffer; contentType: string }[] = [];
  for (let i = 0; i < photoUrls.length; i++) {
    const raw = typeof photoUrls[i] === "string" ? photoUrls[i].trim() : "";
    if (!raw || !isHttpsUrl(raw)) continue;
    try {
      const r = await fetch(raw);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 8 * 1024 * 1024) continue;
      const ct = (r.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
      const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : ct.includes("gif") ? "gif" : "jpg";
      out.push({
        filename: `site-photo-${i + 1}.${ext}`,
        content: buf,
        contentType: ct || "image/jpeg",
      });
    } catch {
      /* skip broken or blocked URL */
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  const startedAt = nowMs();
  const marks: Array<[string, number]> = [];
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const { quoteId, recipientEmail, recipientName, notes, items, customMessage, scope, attachRequestPhotos } = body as {
      quoteId: string;
      recipientEmail?: string;
      recipientName?: string;
      notes?: string;
      customMessage?: string;
      scope?: string;
      items?: { description: string; quantity: number; unitPrice: number; total: number }[];
      /** When set, overrides saved quote preference for this send only. */
      attachRequestPhotos?: boolean;
    };

    if (!quoteId || typeof quoteId !== "string") {
      return NextResponse.json({ error: "quoteId is required" }, { status: 400 });
    }
    if (!isValidUUID(quoteId)) {
      return NextResponse.json({ error: "Invalid quoteId" }, { status: 400 });
    }

    const supabase = createServiceClient();

    const tQuote = nowMs();
    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .select("*")
      .eq("id", quoteId)
      .single();
    marks.push(["quote_lookup", nowMs() - tQuote]);

    if (quoteError || !quote) {
      return withServerTiming({ error: "Quote not found" }, 404, marks);
    }

    // Fetch line items (if not pre-provided) and company settings in parallel.
    const tDeps = nowMs();
    const [lineItemResult, settingsResult] = await Promise.all([
      items?.length
        ? Promise.resolve(null)
        : supabase.from("quote_line_items").select("description, quantity, unit_price").eq("quote_id", quoteId).order("sort_order"),
      supabase.from("company_settings").select("*").limit(1).single(),
    ]);
    marks.push(["deps_fetch", nowMs() - tDeps]);

    let lineItemsForPdf = items;
    if (!lineItemsForPdf?.length && lineItemResult) {
      const rows = (lineItemResult as { data: { description: string; quantity: number; unit_price: number }[] | null }).data ?? [];
      lineItemsForPdf = rows.map((r) => ({
        description: r.description,
        quantity: Number(r.quantity) || 1,
        unitPrice: Number(r.unit_price) || 0,
        total: (Number(r.quantity) || 1) * (Number(r.unit_price) || 0),
      }));
    }

    const { data: settings } = settingsResult as { data: Record<string, unknown> | null };

    const branding: CompanyBranding = settings
      ? {
          companyName: String(settings.company_name ?? ""),
          logoUrl: settings.logo_url ? String(settings.logo_url) : undefined,
          address: String(settings.address ?? ""),
          phone: String(settings.phone ?? ""),
          email: String(settings.email ?? ""),
          website: settings.website ? String(settings.website) : undefined,
          vatNumber: settings.vat_number ? String(settings.vat_number) : undefined,
          primaryColor: String(settings.primary_color ?? "#F97316"),
          tagline: settings.tagline ? String(settings.tagline) : undefined,
        }
      : {
          companyName: "Master Group",
          address: "123 Business Street, London, UK",
          phone: "+44 20 1234 5678",
          email: "info@mastergroup.com",
          primaryColor: "#F97316",
          tagline: "Professional Property Services",
        };

    const pdfData: QuotePDFData = {
      reference: quote.reference,
      title: quote.title,
      clientName: recipientName ?? quote.client_name,
      clientEmail: recipientEmail ?? quote.client_email,
      totalValue: Number(quote.total_value),
      createdAt: quote.created_at,
      expiresAt: quote.expires_at ?? undefined,
      ownerName: quote.owner_name ?? undefined,
      items: lineItemsForPdf,
      notes: notes ?? (settings?.quote_footer_notes ? String(settings.quote_footer_notes) : undefined),
      depositRequired: Number(quote.deposit_required ?? 0) || undefined,
      scope:
        typeof scope === "string" && scope.trim()
          ? scope.trim()
          : typeof quote.scope === "string" && quote.scope.trim()
            ? quote.scope.trim()
            : undefined,
    };

    const tPdf = nowMs();
    const pdfBuffer = await renderToBuffer(
      React.createElement(QuotePDF, { data: pdfData, branding }) as Parameters<typeof renderToBuffer>[0],
    );
    marks.push(["pdf_render", nowMs() - tPdf]);

    const emailTo = recipientEmail ?? quote.client_email;
    if (!emailTo) {
      marks.push(["total", nowMs() - startedAt]);
      return withServerTiming(
        { pdfGenerated: true, emailSent: false, reason: "No recipient email" },
        200,
        marks,
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
    const responseToken = createQuoteResponseToken(quoteId);
    const acceptUrl = `${baseUrl}/quote/respond?token=${encodeURIComponent(responseToken)}&action=accept`;
    const rejectUrl = `${baseUrl}/quote/respond?token=${encodeURIComponent(responseToken)}&action=reject`;

    const fromEmail = process.env.RESEND_FROM_EMAIL ?? `${branding.companyName} <quotes@${branding.website ?? "mastergroup.com"}>`;

    const resendKey = process.env.RESEND_API_KEY?.trim();
    if (!resendKey) {
      marks.push(["total", nowMs() - startedAt]);
      return withServerTiming(
        { pdfGenerated: true, emailSent: false, reason: "RESEND_API_KEY not configured" },
        200,
        marks,
      );
    }
    const resend = new Resend(resendKey);

    const useRequestPhotos =
      typeof attachRequestPhotos === "boolean" ? attachRequestPhotos : Boolean(quote.email_attach_request_photos);
    const emailAttachments: { filename: string; content: Buffer; contentType?: string }[] = [
      {
        filename: `${quote.reference.replace(/\//g, "-")}_quote.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ];
    if (useRequestPhotos && quote.request_id) {
      const tPhotos = nowMs();
      const { data: sr } = await supabase
        .from("service_requests")
        .select("images")
        .eq("id", quote.request_id)
        .maybeSingle();
      const urls = normalizeJsonImageArray(sr?.images);
      const extras = await sitePhotoAttachments(urls);
      emailAttachments.push(...extras);
      marks.push(["photos_attach", nowMs() - tPhotos]);
    }

    const tEmail = nowMs();
    const { data: emailResult, error: emailError } = await resend.emails.send({
      from: fromEmail,
      to: [emailTo],
      subject: `Quote ${quote.reference} — ${quote.title}`,
      html: buildQuoteEmailHTML(pdfData, branding, { acceptUrl, rejectUrl, customMessage }),
      attachments: emailAttachments,
    });
    marks.push(["email_send", nowMs() - tEmail]);

    if (emailError) {
      console.error("Resend error:", emailError);
      marks.push(["total", nowMs() - startedAt]);
      return withServerTiming(
        { pdfGenerated: true, emailSent: false, error: emailError.message },
        500,
        marks,
      );
    }

    const sentAt = new Date().toISOString();
    const tWrite = nowMs();
    await supabase
      .from("quotes")
      .update({ status: "awaiting_customer", customer_pdf_sent_at: sentAt })
      .eq("id", quoteId);

    await supabase.from("audit_logs").insert({
      entity_type: "quote",
      entity_id: quoteId,
      entity_ref: quote.reference,
      action: "status_changed",
      field_name: "status",
      old_value: quote.status,
      new_value: "awaiting_customer",
      metadata: { email_to: emailTo, resend_id: emailResult?.id },
    });
    marks.push(["db_updates", nowMs() - tWrite]);
    marks.push(["total", nowMs() - startedAt]);

    return withServerTiming({
      pdfGenerated: true,
      emailSent: true,
      emailId: emailResult?.id,
      sentTo: emailTo,
    }, 200, marks);
  } catch (err) {
    console.error("Quote PDF/send error:", err);
    const marks: Array<[string, number]> = [["total", nowMs() - startedAt]];
    return withServerTiming(
      { error: err instanceof Error ? err.message : "Internal error" },
      500,
      marks,
    );
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const quoteId = req.nextUrl.searchParams.get("quoteId");
    if (!quoteId) {
      return NextResponse.json({ error: "quoteId is required" }, { status: 400 });
    }
    if (!isValidUUID(quoteId)) {
      return NextResponse.json({ error: "Invalid quoteId" }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: quote, error } = await supabase
      .from("quotes")
      .select("*")
      .eq("id", quoteId)
      .single();

    if (error || !quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    const [lineItemResult, settingsResult] = await Promise.all([
      supabase
        .from("quote_line_items")
        .select("description, quantity, unit_price")
        .eq("quote_id", quoteId)
        .order("sort_order"),
      supabase.from("company_settings").select("*").limit(1).single(),
    ]);

    const lineRows = (lineItemResult as { data: { description: string; quantity: number; unit_price: number }[] | null }).data ?? [];
    const items =
      lineRows.length > 0
        ? lineRows.map((r) => ({
            description: r.description,
            quantity: Number(r.quantity) || 1,
            unitPrice: Number(r.unit_price) || 0,
            total: (Number(r.quantity) || 1) * (Number(r.unit_price) || 0),
          }))
        : undefined;

    const { data: settings } = settingsResult as { data: Record<string, unknown> | null };

    const branding: CompanyBranding = settings
      ? {
          companyName: String(settings.company_name ?? ""),
          logoUrl: settings.logo_url ? String(settings.logo_url) : undefined,
          address: String(settings.address ?? ""),
          phone: String(settings.phone ?? ""),
          email: String(settings.email ?? ""),
          website: settings.website ? String(settings.website) : undefined,
          vatNumber: settings.vat_number ? String(settings.vat_number) : undefined,
          primaryColor: String(settings.primary_color ?? "#F97316"),
          tagline: settings.tagline ? String(settings.tagline) : undefined,
        }
      : {
          companyName: "Master Group",
          address: "124 City Road, London, UK",
          phone: "+44 20 1234 5678",
          email: "hello@wearemaster.com",
          primaryColor: "#F97316",
          tagline: "Professional Property Services",
        };

    const pdfData: QuotePDFData = {
      reference: quote.reference,
      title: quote.title,
      clientName: quote.client_name,
      clientEmail: quote.client_email,
      totalValue: Number(quote.total_value),
      createdAt: quote.created_at,
      expiresAt: quote.expires_at ?? undefined,
      ownerName: quote.owner_name ?? undefined,
      items,
      notes: settings?.quote_footer_notes ? String(settings.quote_footer_notes) : undefined,
      depositRequired: Number(quote.deposit_required ?? 0) || undefined,
      scope: typeof quote.scope === "string" && quote.scope.trim() ? quote.scope.trim() : undefined,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfBuffer = await (renderToBuffer as any)(
      React.createElement(QuotePDF, { data: pdfData, branding }),
    );

    const safeName = `${quote.reference.replace(/\//g, "-")}_quote.pdf`;
    const asAttachment = req.nextUrl.searchParams.get("download") === "1";

    return new Response(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${asAttachment ? "attachment" : "inline"}; filename="${safeName}"`,
      },
    });
  } catch (err) {
    console.error("PDF generation error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}

