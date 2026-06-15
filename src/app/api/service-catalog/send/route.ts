import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requireAuth } from "@/lib/auth-api";
import { requireServiceCatalogAuth } from "@/lib/service-catalog-auth";
import { buildClientCatalogEmailHTML } from "@/lib/client-catalog-email-template";
import { appBaseUrl } from "@/lib/app-base-url";
import {
  publishClientCatalogSnapshot,
  renderClientCatalogPdfBuffer,
} from "@/services/client-catalog-storage";
import { buildClientCatalogPayload } from "@/lib/client-catalog-payload";
import { createServiceClient, isServiceRoleConfigured } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseEmails(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

/** POST /api/service-catalog/send — email rate card with PDF attachment + links. */
export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const forbidden = await requireServiceCatalogAuth(auth);
  if (forbidden) return forbidden;

  if (!isServiceRoleConfigured()) {
    return NextResponse.json(
      { error: "Storage not configured", message: "Service role required." },
      { status: 503 },
    );
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "Email not configured", message: "RESEND_API_KEY missing." }, { status: 503 });
  }

  let body: { to?: string; recipientName?: string; subject?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const recipients = parseEmails(body.to);
  if (recipients.length === 0) {
    return NextResponse.json({ error: "At least one valid recipient email is required." }, { status: 400 });
  }

  try {
    const payload = await buildClientCatalogPayload();
    const pdfBuffer = await renderClientCatalogPdfBuffer(payload);
    const published = await publishClientCatalogSnapshot();

    const supabase = createServiceClient();
    const { data: settings } = await supabase
      .from("company_settings")
      .select("company_name, logo_url")
      .limit(1)
      .maybeSingle();

    const companyName = (settings?.company_name as string | null)?.trim() || "Fixfy";
    const logoUrl =
      (settings?.logo_url as string | null)?.trim() ||
      "https://www.getfixfy.com/brand/fixfy-primary-white.png";

    const html = buildClientCatalogEmailHTML({
      recipientName: body.recipientName,
      message: body.message,
      liveUrl: published.liveUrl || `${appBaseUrl()}/catalog`,
      pdfUrl: published.pdfUrl ?? "",
      companyName,
      logoUrl,
    });

    const subject =
      body.subject?.trim() || `${companyName} — rate card & prices`;

    const resend = new Resend(apiKey);
    const fromEmail =
      process.env.RESEND_FROM_EMAIL?.trim() || `Fixfy <quotes@getfixfy.com>`;

    const { error } = await resend.emails.send({
      from: fromEmail,
      to: recipients,
      subject,
      html,
      attachments: [
        {
          filename: "Fixfy-Rate-Card.pdf",
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    if (error) {
      console.error("[api/service-catalog/send] resend", error);
      return NextResponse.json({ error: error.message || "Could not send email." }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      sentTo: recipients,
      liveUrl: published.liveUrl,
      pdfUrl: published.pdfUrl,
      warnings: published.warnings,
    });
  } catch (err) {
    console.error("[api/service-catalog/send]", err);
    return NextResponse.json({ error: "Could not send rate card email." }, { status: 500 });
  }
}
