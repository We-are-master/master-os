import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeJsonImageArray } from "@/lib/request-attachment-images";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isHttpsUrl(u: string): boolean {
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
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
      photoUrls = normalizeJsonImageArray(sr?.images).filter((u) => isHttpsUrl(u.trim()));
      description = typeof sr?.description === "string" ? sr.description : "";
    }

    const { data: partners } = await supabase.from("partners").select("id, email, company_name").in("id", partnerIds);

    const resendKey = process.env.RESEND_API_KEY?.trim();
    if (!resendKey) {
      return NextResponse.json({ ok: false, sent: 0, reason: "RESEND_API_KEY not configured" }, { status: 200 });
    }

    const resend = new Resend(resendKey);
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "Master <quotes@example.com>";

    const imgHtml = photoUrls
      .map((u, i) => {
        const safe = u.replace(/"/g, "");
        return `<p style="margin:12px 0"><a href="${safe}">Site photo ${i + 1}</a></p><img src="${safe}" alt="" width="560" style="max-width:100%;height:auto;border-radius:8px;border:1px solid #e5e5e5" />`;
      })
      .join("");

    const sendOne = async (p: { email?: string | null; company_name?: string | null }) => {
      const email = p.email?.trim();
      if (!email) return false;
      const html = `
        <p>Hi ${escapeHtml(p.company_name ?? "there")},</p>
        <p>You have been invited to bid on <strong>${escapeHtml(quote.reference)}</strong> — ${escapeHtml(quote.title ?? "")}</p>
        <p><strong>Property:</strong> ${escapeHtml(quote.property_address ?? "—")}</p>
        ${description.trim() ? `<p><strong>Service description:</strong><br/>${escapeHtml(description).replace(/\n/g, "<br/>")}</p>` : ""}
        ${imgHtml || "<p><em>No site photos were attached to this request.</em></p>"}
        <p style="margin-top:16px">Open the <strong>partner app</strong> to view the full quote and submit your bid.</p>
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
