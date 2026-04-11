import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth-api";
import { checkRateLimit } from "@/lib/rate-limit";
import { renderTemplate, partnerVars } from "@/lib/outreach/render-template";
import { wrapOutreachHtml, DEFAULT_BRANDING } from "@/lib/outreach/email-shell";
import type { OutreachSendRequest, OutreachTemplateVars } from "@/types/outreach";
import type { CompanyBranding } from "@/lib/pdf/quote-template";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type PartnerRow = {
  id: string;
  contact_name: string | null;
  company_name: string | null;
  email: string | null;
  trade: string | null;
};

type ResolvedRecipient = {
  partnerId: string | null;
  email: string;
  name: string | null;
  vars: OutreachTemplateVars;
};

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  // Admin gate — mirrors pattern in /api/admin/partner/send-email/route.ts
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", auth.user.id)
    .single();
  const profileRole = (profile as { role?: string; full_name?: string } | null)?.role;
  const profileName = (profile as { role?: string; full_name?: string } | null)?.full_name ?? auth.user.email ?? null;
  if (profileRole !== "admin") {
    return NextResponse.json({ error: "Forbidden", message: "Admin only" }, { status: 403 });
  }

  // Rate limit: 5 campaigns / min / user
  const rl = checkRateLimit(`outreach:${auth.user.id}`, 5, 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many campaigns. Please wait before sending another." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let body: OutreachSendRequest;
  try {
    body = (await req.json()) as OutreachSendRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const bodyHtml = typeof body.bodyHtml === "string" ? body.bodyHtml.trim() : "";
  if (!subject) return NextResponse.json({ error: "Subject is required" }, { status: 400 });
  if (!bodyHtml || bodyHtml === "<p></p>") {
    return NextResponse.json({ error: "Body is required" }, { status: 400 });
  }

  const partnerIds = Array.isArray(body.recipients?.partnerIds) ? body.recipients.partnerIds : [];
  const externalEmailsRaw = Array.isArray(body.recipients?.externalEmails) ? body.recipients.externalEmails : [];
  const testMode = Boolean(body.testMode);

  if (!testMode && partnerIds.length === 0 && externalEmailsRaw.length === 0) {
    return NextResponse.json({ error: "At least one recipient is required" }, { status: 400 });
  }

  const admin = createServiceClient();

  // Load partners + company settings in parallel
  const [partnerResult, settingsResult] = await Promise.all([
    partnerIds.length > 0
      ? admin
          .from("partners")
          .select("id, contact_name, company_name, email, trade")
          .in("id", partnerIds)
      : Promise.resolve({ data: [], error: null }),
    admin.from("company_settings").select("*").limit(1).single(),
  ]);

  if (partnerResult.error) {
    console.error("[outreach/send] partners fetch error:", partnerResult.error);
    return NextResponse.json({ error: "Failed to load partners" }, { status: 500 });
  }
  const partners = (partnerResult.data ?? []) as PartnerRow[];

  const settings = (settingsResult as { data: Record<string, unknown> | null }).data;
  const branding: CompanyBranding = settings
    ? {
        companyName: String(settings.company_name ?? DEFAULT_BRANDING.companyName),
        logoUrl: settings.logo_url ? String(settings.logo_url) : undefined,
        address: String(settings.address ?? DEFAULT_BRANDING.address),
        phone: String(settings.phone ?? DEFAULT_BRANDING.phone),
        email: String(settings.email ?? DEFAULT_BRANDING.email),
        website: settings.website ? String(settings.website) : undefined,
        primaryColor: String(settings.primary_color ?? DEFAULT_BRANDING.primaryColor ?? "#F97316"),
        tagline: settings.tagline ? String(settings.tagline) : undefined,
      }
    : DEFAULT_BRANDING;

  // Resolve recipients
  const resolved: ResolvedRecipient[] = [];
  const skipped: { input: string; reason: string }[] = [];

  if (testMode) {
    const testEmail = auth.user.email;
    if (!testEmail) {
      return NextResponse.json({ error: "Your admin account has no email on file" }, { status: 400 });
    }
    const sample: PartnerRow =
      partners[0] ?? {
        id: "",
        contact_name: profileName ?? "Admin",
        company_name: "Master Group",
        email: testEmail,
        trade: "geral",
      };
    resolved.push({
      partnerId: null,
      email: testEmail,
      name: profileName,
      vars: partnerVars(sample),
    });
  } else {
    for (const p of partners) {
      if (!p.email || !isValidEmail(p.email)) {
        skipped.push({ input: p.company_name ?? p.id, reason: "missing or invalid email" });
        continue;
      }
      resolved.push({
        partnerId: p.id,
        email: p.email,
        name: p.contact_name,
        vars: partnerVars(p),
      });
    }

    // External emails (comma/newline-separated input is already split by the client)
    const seen = new Set(resolved.map((r) => r.email.toLowerCase()));
    for (const raw of externalEmailsRaw) {
      const e = typeof raw === "string" ? raw.trim() : "";
      if (!e) continue;
      if (!isValidEmail(e)) {
        skipped.push({ input: e, reason: "invalid email" });
        continue;
      }
      if (seen.has(e.toLowerCase())) continue;
      seen.add(e.toLowerCase());
      resolved.push({
        partnerId: null,
        email: e,
        name: null,
        vars: { email: e },
      });
    }
  }

  if (resolved.length === 0) {
    return NextResponse.json(
      { error: "No valid recipients", skipped },
      { status: 400 },
    );
  }

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    return NextResponse.json(
      { error: "RESEND_API_KEY not configured" },
      { status: 503 },
    );
  }
  const resend = new Resend(resendKey);
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ??
    `${branding.companyName} <hello@${branding.website?.replace(/^https?:\/\//, "") ?? "mastergroup.com"}>`;

  // ─── Test mode: send immediately without creating a campaign row ───
  if (testMode) {
    const r = resolved[0]!;
    const rendered = wrapOutreachHtml({
      bodyHtml: renderTemplate(bodyHtml, r.vars),
      branding,
      preheader: "Test send",
    });
    const { data: sent, error: sendError } = await resend.emails.send({
      from: fromEmail,
      to: [r.email],
      subject: `[TEST] ${renderTemplate(subject, r.vars)}`,
      html: rendered,
    });
    if (sendError) {
      console.error("[outreach/send] test send error:", sendError);
      return NextResponse.json(
        { error: "Test email failed to send", details: sendError.message },
        { status: 502 },
      );
    }
    return NextResponse.json({ testMode: true, messageId: sent?.id, sentTo: r.email });
  }

  // ─── Real send: create campaign + recipients, then dispatch ───
  const { data: campaign, error: campaignError } = await admin
    .from("outreach_campaigns")
    .insert({
      template_id: body.templateId ?? null,
      subject,
      body_html: bodyHtml,
      sent_by: auth.user.id,
      sent_by_name: profileName,
      recipient_count: resolved.length,
      status: "sending",
    })
    .select("id")
    .single();

  if (campaignError || !campaign) {
    console.error("[outreach/send] campaign insert error:", campaignError);
    return NextResponse.json({ error: "Failed to create campaign" }, { status: 500 });
  }

  const campaignId = (campaign as { id: string }).id;

  const recipientRows = resolved.map((r) => ({
    campaign_id: campaignId,
    partner_id: r.partnerId,
    email: r.email,
    name: r.name,
    status: "queued",
  }));

  const { data: insertedRecipients, error: recipientsError } = await admin
    .from("outreach_campaign_recipients")
    .insert(recipientRows)
    .select("id, email");

  if (recipientsError || !insertedRecipients) {
    console.error("[outreach/send] recipients insert error:", recipientsError);
    await admin.from("outreach_campaigns").update({ status: "failed" }).eq("id", campaignId);
    return NextResponse.json({ error: "Failed to create recipients" }, { status: 500 });
  }

  // Map resolved order → recipient row id (emails may repeat if user wasn't deduped, but we dedup above)
  const idByEmail = new Map<string, string>();
  for (const row of insertedRecipients as { id: string; email: string }[]) {
    idByEmail.set(row.email.toLowerCase(), row.id);
  }

  // Dispatch in parallel chunks (12 concurrent sends per wave keeps us
  // well under Resend's rate limit while staying fast enough to render
  // dozens of emails in < 10s).
  const CHUNK = 12;
  let sentCount = 0;
  let failedCount = 0;

  for (let i = 0; i < resolved.length; i += CHUNK) {
    const slice = resolved.slice(i, i + CHUNK);
    await Promise.all(
      slice.map(async (r) => {
        const recipientId = idByEmail.get(r.email.toLowerCase());
        if (!recipientId) return;
        try {
          const { data: sent, error: sendErr } = await resend.emails.send({
            from: fromEmail,
            to: [r.email],
            subject: renderTemplate(subject, r.vars),
            html: wrapOutreachHtml({
              bodyHtml: renderTemplate(bodyHtml, r.vars),
              branding,
            }),
          });
          if (sendErr || !sent?.id) {
            throw sendErr ?? new Error("no message id returned");
          }
          sentCount++;
          await admin
            .from("outreach_campaign_recipients")
            .update({ resend_message_id: sent.id, status: "sent" })
            .eq("id", recipientId);
        } catch (err) {
          failedCount++;
          const errorMessage = err instanceof Error ? err.message : "Send failed";
          console.error("[outreach/send] dispatch error:", r.email, err);
          await admin
            .from("outreach_campaign_recipients")
            .update({ status: "failed", error_message: errorMessage })
            .eq("id", recipientId);
        }
      }),
    );
  }

  const finalStatus =
    sentCount === 0 ? "failed" : failedCount === 0 ? "sent" : "partial";

  await admin
    .from("outreach_campaigns")
    .update({
      status: finalStatus,
      failed_count: failedCount,
    })
    .eq("id", campaignId);

  return NextResponse.json({
    campaignId,
    recipientCount: resolved.length,
    sent: sentCount,
    failed: failedCount,
    skipped,
  });
}
