import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createQuoteResponseToken } from "@/lib/quote-response-token";
import { buildQuoteEmailHTML } from "@/lib/quote-email-template";
import type { QuotePDFData, CompanyBranding } from "@/lib/pdf/quote-template";
import { resolveNominalBillingParty } from "@/lib/account-billing-addressee";

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SERVICE_ROLE_KEY!,
  );
}

/**
 * GET /api/quotes/email-preview?quoteId=xxx&recipientName=...&customMessage=...
 * Returns the HTML body of the email that will be sent (for preview in the dashboard).
 */
async function buildPreview(req: NextRequest, payload?: {
  quoteId?: string;
  recipientName?: string;
  customMessage?: string;
  scope?: string;
  depositRequired?: number;
  items?: { description: string; quantity: number; unitPrice: number; total: number }[];
}) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const quoteId = payload?.quoteId ?? req.nextUrl.searchParams.get("quoteId") ?? undefined;
    const recipientName = payload?.recipientName ?? req.nextUrl.searchParams.get("recipientName") ?? undefined;
    const customMessage = payload?.customMessage ?? req.nextUrl.searchParams.get("customMessage") ?? undefined;
    const scopeOverride = payload?.scope;
    const depositOverride = payload?.depositRequired;
    const itemsOverride = payload?.items;

    if (!quoteId || !isValidUUID(quoteId)) {
      return NextResponse.json({ error: "Valid quoteId is required" }, { status: 400 });
    }

    const supabase = getServiceSupabase();
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
      itemsOverride?.length
        ? Promise.resolve(null)
        : supabase
            .from("quote_line_items")
            .select("description, quantity, unit_price")
            .eq("quote_id", quoteId)
            .order("sort_order", { ascending: true }),
      supabase.from("company_settings").select("*").limit(1).single(),
    ]);

    let items = itemsOverride;
    if (!items?.length && lineItemResult) {
      const lineItemRows = (lineItemResult as { data: { description: string; quantity: number; unit_price: number }[] | null }).data;
      items = lineItemRows?.map((r) => ({
        description: r.description,
        quantity: Number(r.quantity) || 1,
        unitPrice: Number(r.unit_price) || 0,
        total: (Number(r.quantity) || 1) * (Number(r.unit_price) || 0),
      })) ?? undefined;
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

    const vatPercentPreview =
      settings && settings.vat_percent != null
        ? Number(settings.vat_percent)
        : 20;

    const qPrev = quote as { client_id?: string | null; client_name?: string; client_email?: string | null };
    const qCid = qPrev.client_id?.trim() ?? "";
    const docPartyPrev =
      qCid.length > 0
        ? await resolveNominalBillingParty(supabase, {
            clientId: qCid,
            fallbackName: qPrev.client_name,
            fallbackEmail: qPrev.client_email,
          })
        : null;
    const previewClientName = String(
      (docPartyPrev ? docPartyPrev.displayName : (recipientName ?? qPrev.client_name)) ?? "",
    );
    const previewClientEmail = String(
      (docPartyPrev ? (docPartyPrev.documentEmail ?? qPrev.client_email) : qPrev.client_email) ?? "",
    );

    const pdfData: QuotePDFData = {
      reference: quote.reference,
      title: quote.title,
      clientName: previewClientName,
      clientEmail: previewClientEmail,
      totalValue: Number(quote.total_value),
      createdAt: quote.created_at,
      expiresAt: quote.expires_at ?? undefined,
      ownerName: quote.owner_name ?? undefined,
      items,
      notes: settings?.quote_footer_notes ? String(settings.quote_footer_notes) : undefined,
      depositRequired: Number(depositOverride ?? quote.deposit_required ?? 0) || undefined,
      scope:
        typeof scopeOverride === "string" && scopeOverride.trim()
          ? scopeOverride.trim()
          : typeof quote.scope === "string" && quote.scope.trim()
            ? quote.scope.trim()
            : undefined,
      vatPercent: vatPercentPreview,
    };

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
    const token = createQuoteResponseToken(quoteId);
    const acceptUrl = `${baseUrl}/quote/respond?token=${encodeURIComponent(token)}&action=accept`;
    const rejectUrl = `${baseUrl}/quote/respond?token=${encodeURIComponent(token)}&action=reject`;

    const html = buildQuoteEmailHTML(pdfData, branding, {
      acceptUrl,
      rejectUrl,
      customMessage: customMessage || undefined,
    });

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    console.error("Email preview error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return buildPreview(req);
}

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as {
      quoteId?: string;
      recipientName?: string;
      customMessage?: string;
      scope?: string;
      depositRequired?: number;
      items?: { description: string; quantity: number; unitPrice: number; total: number }[];
    };
    return buildPreview(req, payload);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}
