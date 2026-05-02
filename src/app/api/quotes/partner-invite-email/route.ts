import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeJsonImageArray } from "@/lib/request-attachment-images";
import { escapeHtmlAttr, normalizeEmailAssetUrl } from "@/lib/email-asset-url";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function publicOsBaseUrl(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (env) return env;
  return req.nextUrl.origin;
}

/** Email selected partners when inviting to bid (includes site photo links from the linked request). */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await req.json();
    const quoteId = typeof body.quoteId === "string" ? body.quoteId.trim() : "";
    const partnerIds = Array.isArray(body.partnerIds)
      ? (body.partnerIds as unknown[]).filter((x): x is string => typeof x === "string" && isValidUUID(x.trim()))
      : [];
    if (!quoteId || !isValidUUID(quoteId)) {
      return NextResponse.json({ error: "quoteId is required" }, { status: 400 });
    }
    if (partnerIds.length === 0) {
      return NextResponse.json({ ok: true, sent: 0 });
    }

    const supabase = createServiceClient();
    const { data: quote, error: qErr } = await supabase
      .from("quotes")
      .select("id, reference, title, property_address, request_id")
      .eq("id", quoteId)
      .single();
    if (qErr || !quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    let photoUrls: string[] = [];
    let description = "";
    if (quote.request_id) {
      const { data: sr } = await supabase
        .from("service_requests")
        .select("images, description")
        .eq("id", quote.request_id)
        .maybeSingle();
      photoUrls = normalizeJsonImageArray(sr?.images)
        .map((u) => normalizeEmailAssetUrl(u))
        .filter((u): u is string => u != null);
      description = typeof sr?.description === "string" ? sr.description : "";
    }

    const { data: partners } = await supabase.from("partners").select("id, email, company_name").in("id", partnerIds);

    const resendKey = process.env.RESEND_API_KEY?.trim();
    if (!resendKey) {
      return NextResponse.json({ ok: false, sent: 0, reason: "RESEND_API_KEY not configured" }, { status: 200 });
    }

    const resend = new Resend(resendKey);
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "Fixfy <quotes@example.com>";

    const imgHtml = photoUrls
      .map((u, i) => {
        const href = escapeHtmlAttr(u);
        return `<p style="margin:12px 0"><a href="${href}">Site photo ${i + 1}</a></p><img src="${href}" alt="" width="560" style="max-width:100%;height:auto;border-radius:8px;border:1px solid #e5e5e5" />`;
      })
      .join("");

    const iosStore = process.env.PARTNER_APP_IOS_URL?.trim() || process.env.NEXT_PUBLIC_PARTNER_APP_IOS_URL?.trim();
    const androidStore = process.env.PARTNER_APP_ANDROID_URL?.trim() || process.env.NEXT_PUBLIC_PARTNER_APP_ANDROID_URL?.trim();
    const deepLink = `masterservices://invite?quoteId=${encodeURIComponent(quoteId)}`;
    const deepEsc = escapeHtmlAttr(deepLink);
    const storeLinks: string[] = [];
    if (iosStore) {
      storeLinks.push(`<a href="${escapeHtmlAttr(iosStore)}">App Store</a>`);
    }
    if (androidStore) {
      storeLinks.push(`<a href="${escapeHtmlAttr(androidStore)}">Google Play</a>`);
    }
    const storeBlock =
      storeLinks.length > 0
        ? `<p style="margin:12px 0">${storeLinks.join(" · ")}</p>`
        : `<p style="margin:12px 0;color:#444;font-size:14px">Install <strong>Fixfy</strong> from the App Store or Google Play, sign in, then open <strong>Invites</strong> to view this request and submit your bid.</p>`;

    const officeQuoteUrl = `${publicOsBaseUrl(req)}/quotes?quoteId=${encodeURIComponent(quoteId)}&drawerTab=bids`;
    const officeEsc = escapeHtmlAttr(officeQuoteUrl);

    const sendOne = async (p: { email?: string | null; company_name?: string | null }) => {
      const email = p.email?.trim();
      if (!email) return false;
      const html = `
        <p>Hi ${escapeHtml(p.company_name ?? "there")},</p>
        <p>You have been invited to bid on <strong>${escapeHtml(quote.reference)}</strong> — ${escapeHtml(quote.title ?? "")}</p>
        <p><strong>Property:</strong> ${escapeHtml(quote.property_address ?? "—")}</p>
        ${description.trim() ? `<p><strong>Service description:</strong><br/>${escapeHtml(description).replace(/\n/g, "<br/>")}</p>` : ""}
        ${imgHtml || "<p><em>No site photos were attached to this request.</em></p>"}
        <p style="margin-top:20px"><strong>Submit your bid in the partner app</strong></p>
        ${storeBlock}
        <p style="margin:12px 0;font-size:14px"><a href="${deepEsc}">Open invitation in app</a> (tap after installing Fixfy)</p>
        <p style="margin-top:16px;font-size:12px;color:#666">Office link (login required): <a href="${officeEsc}">View quote in Fixfy OS</a></p>
      `;
      const { error } = await resend.emails.send({
        from: fromEmail,
        to: [email],
        subject: `Quote invitation ${quote.reference} — ${quote.title ?? "Bid request"}`,
        html,
      });
      return !error;
    };

    const results = await Promise.all((partners ?? []).map((p) => sendOne(p)));
    const sent = results.filter(Boolean).length;

    return NextResponse.json({ ok: true, sent });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
