import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { Resend } from "resend";
import React from "react";
import { QuotePDF, type QuotePDFData, type CompanyBranding } from "@/lib/pdf/quote-template";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createQuoteResponseToken } from "@/lib/quote-response-token";
import { buildQuoteEmailHTML } from "@/lib/quote-email-template";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const { quoteId, recipientEmail, recipientName, notes, items, customMessage, scope } = body as {
      quoteId: string;
      recipientEmail?: string;
      recipientName?: string;
      notes?: string;
      customMessage?: string;
      scope?: string;
      items?: { description: string; quantity: number; unitPrice: number; total: number }[];
    };

    if (!quoteId || typeof quoteId !== "string") {
      return NextResponse.json({ error: "quoteId is required" }, { status: 400 });
    }
    if (!isValidUUID(quoteId)) {
      return NextResponse.json({ error: "Invalid quoteId" }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .select("*")
      .eq("id", quoteId)
      .single();

    if (quoteError || !quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    // Fetch line items (if not pre-provided) and company settings in parallel.
    const [lineItemResult, settingsResult] = await Promise.all([
      items?.length
        ? Promise.resolve(null)
        : supabase.from("quote_line_items").select("description, quantity, unit_price").eq("quote_id", quoteId).order("sort_order"),
      supabase.from("company_settings").select("*").limit(1).single(),
    ]);

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfBuffer = await (renderToBuffer as any)(
      React.createElement(QuotePDF, { data: pdfData, branding }),
    );

    const emailTo = recipientEmail ?? quote.client_email;
    if (!emailTo) {
      return NextResponse.json(
        { pdfGenerated: true, emailSent: false, reason: "No recipient email" },
        { status: 200 },
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
    const responseToken = createQuoteResponseToken(quoteId);
    const acceptUrl = `${baseUrl}/quote/respond?token=${encodeURIComponent(responseToken)}&action=accept`;
    const rejectUrl = `${baseUrl}/quote/respond?token=${encodeURIComponent(responseToken)}&action=reject`;

    const fromEmail = process.env.RESEND_FROM_EMAIL ?? `${branding.companyName} <quotes@${branding.website ?? "mastergroup.com"}>`;

    const resendKey = process.env.RESEND_API_KEY?.trim();
    if (!resendKey) {
      return NextResponse.json(
        { pdfGenerated: true, emailSent: false, reason: "RESEND_API_KEY not configured" },
        { status: 200 },
      );
    }
    const resend = new Resend(resendKey);

    const { data: emailResult, error: emailError } = await resend.emails.send({
      from: fromEmail,
      to: [emailTo],
      subject: `Quote ${quote.reference} — ${quote.title}`,
      html: buildQuoteEmailHTML(pdfData, branding, { acceptUrl, rejectUrl, customMessage }),
      attachments: [
        {
          filename: `${quote.reference.replace(/\//g, "-")}_quote.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    if (emailError) {
      console.error("Resend error:", emailError);
      return NextResponse.json(
        { pdfGenerated: true, emailSent: false, error: emailError.message },
        { status: 500 },
      );
    }

    const sentAt = new Date().toISOString();
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

    return NextResponse.json({
      pdfGenerated: true,
      emailSent: true,
      emailId: emailResult?.id,
      sentTo: emailTo,
    });
  } catch (err) {
    console.error("Quote PDF/send error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
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

    return new Response(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${quote.reference.replace(/\//g, "-")}_quote.pdf"`,
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

