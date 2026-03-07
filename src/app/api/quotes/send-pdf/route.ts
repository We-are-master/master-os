import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { Resend } from "resend";
import React from "react";
import { QuotePDF, type QuotePDFData, type CompanyBranding } from "@/lib/pdf/quote-template";
import { createServiceClient } from "@/lib/supabase/service";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { quoteId, recipientEmail, recipientName, notes, items } = body as {
      quoteId: string;
      recipientEmail?: string;
      recipientName?: string;
      notes?: string;
      items?: { description: string; quantity: number; unitPrice: number; total: number }[];
    };

    if (!quoteId) {
      return NextResponse.json({ error: "quoteId is required" }, { status: 400 });
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

    const { data: settings } = await supabase
      .from("company_settings")
      .select("*")
      .limit(1)
      .single();

    const branding: CompanyBranding = settings
      ? {
          companyName: settings.company_name,
          logoUrl: settings.logo_url ?? undefined,
          address: settings.address ?? "",
          phone: settings.phone ?? "",
          email: settings.email ?? "",
          website: settings.website ?? undefined,
          vatNumber: settings.vat_number ?? undefined,
          primaryColor: settings.primary_color ?? "#F97316",
          tagline: settings.tagline ?? undefined,
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
      items,
      notes: notes ?? settings?.quote_footer_notes ?? undefined,
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

    const fromEmail = process.env.RESEND_FROM_EMAIL ?? `${branding.companyName} <quotes@${branding.website ?? "mastergroup.com"}>`;

    const { data: emailResult, error: emailError } = await resend.emails.send({
      from: fromEmail,
      to: [emailTo],
      subject: `Quote ${quote.reference} — ${quote.title}`,
      html: buildEmailHTML(pdfData, branding),
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

    await supabase
      .from("quotes")
      .update({ status: "sent" })
      .eq("id", quoteId);

    await supabase.from("audit_logs").insert({
      entity_type: "quote",
      entity_id: quoteId,
      entity_ref: quote.reference,
      action: "status_changed",
      field_name: "status",
      old_value: quote.status,
      new_value: "sent",
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
  try {
    const quoteId = req.nextUrl.searchParams.get("quoteId");
    if (!quoteId) {
      return NextResponse.json({ error: "quoteId is required" }, { status: 400 });
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

    const { data: settings } = await supabase
      .from("company_settings")
      .select("*")
      .limit(1)
      .single();

    const branding: CompanyBranding = settings
      ? {
          companyName: settings.company_name,
          logoUrl: settings.logo_url ?? undefined,
          address: settings.address ?? "",
          phone: settings.phone ?? "",
          email: settings.email ?? "",
          website: settings.website ?? undefined,
          vatNumber: settings.vat_number ?? undefined,
          primaryColor: settings.primary_color ?? "#F97316",
          tagline: settings.tagline ?? undefined,
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
      clientName: quote.client_name,
      clientEmail: quote.client_email,
      totalValue: Number(quote.total_value),
      createdAt: quote.created_at,
      expiresAt: quote.expires_at ?? undefined,
      ownerName: quote.owner_name ?? undefined,
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

function buildEmailHTML(data: QuotePDFData, branding: CompanyBranding): string {
  const color = branding.primaryColor ?? "#F97316";
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F5F5F4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;">
    <tr><td style="height:4px;background:${color};"></td></tr>
    <tr><td style="padding:40px 40px 20px;">
      ${branding.logoUrl ? `<img src="${branding.logoUrl}" alt="${branding.companyName}" style="height:40px;margin-bottom:16px;" />` : ""}
      <h1 style="margin:0 0 4px;font-size:24px;color:${color};">${branding.companyName}</h1>
      ${branding.tagline ? `<p style="margin:0 0 20px;font-size:12px;color:#78716C;text-transform:uppercase;letter-spacing:1px;">${branding.tagline}</p>` : ""}
    </td></tr>
    <tr><td style="padding:0 40px 30px;">
      <p style="margin:0 0 8px;font-size:16px;color:#1C1917;">Dear <strong>${data.clientName}</strong>,</p>
      <p style="margin:0 0 20px;font-size:14px;color:#57534E;line-height:1.6;">
        Thank you for your interest. Please find attached our quotation <strong>${data.reference}</strong> for the following:
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E7E5E4;border-radius:8px;overflow:hidden;margin-bottom:20px;">
        <tr style="background:#FAFAF9;">
          <td style="padding:16px;border-bottom:1px solid #E7E5E4;">
            <p style="margin:0 0 4px;font-size:12px;color:#78716C;">Service</p>
            <p style="margin:0;font-size:15px;font-weight:600;color:#1C1917;">${data.title}</p>
          </td>
          <td style="padding:16px;border-bottom:1px solid #E7E5E4;text-align:right;">
            <p style="margin:0 0 4px;font-size:12px;color:#78716C;">Quoted Value</p>
            <p style="margin:0;font-size:20px;font-weight:700;color:${color};">£${data.totalValue.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</p>
          </td>
        </tr>
        <tr>
          <td colspan="2" style="padding:16px;">
            <p style="margin:0;font-size:12px;color:#78716C;">
              Reference: <strong>${data.reference}</strong>
              ${data.expiresAt ? ` — Valid until: <strong>${new Date(data.expiresAt).toLocaleDateString("en-GB")}</strong>` : ""}
            </p>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 24px;font-size:14px;color:#57534E;line-height:1.6;">
        The full breakdown is attached as a PDF. If you have any questions or would like to proceed, simply reply to this email.
      </p>
      <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
        <tr><td style="background:${color};border-radius:8px;padding:14px 32px;">
          <a href="mailto:${branding.email}?subject=Re: ${data.reference}" style="color:#fff;text-decoration:none;font-size:14px;font-weight:600;">
            Reply to Accept
          </a>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:20px 40px;background:#FAFAF9;border-top:1px solid #E7E5E4;">
      <p style="margin:0 0 4px;font-size:11px;color:#A8A29E;">${branding.companyName} — ${branding.address}</p>
      <p style="margin:0;font-size:11px;color:#A8A29E;">${branding.phone} — ${branding.email}</p>
    </td></tr>
  </table>
</body>
</html>`;
}
