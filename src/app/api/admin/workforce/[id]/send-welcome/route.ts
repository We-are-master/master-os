import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createWorkforceOnboardingToken } from "@/lib/workforce-onboarding-token";
import { buildWorkforceWelcomeEmailHTML } from "@/lib/workforce-welcome-email-template";
import type { CompanyBranding } from "@/lib/pdf/quote-template";

const DEFAULT_FROM = "Fixfy <support@getfixfy.com>";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let customMessage = "";
  let sendEmail = true;
  try {
    const body = await req.json();
    if (typeof body?.customMessage === "string") customMessage = body.customMessage;
    if (body?.sendEmail === false) sendEmail = false;
  } catch {
    /* optional body */
  }

  const admin = createServiceClient();
  const { data: person, error: personErr } = await admin
    .from("payroll_internal_costs")
    .select("id, payee_name, amount, pay_frequency, payroll_profile, payment_method, commission_enabled, commission_rate_percent, commission_basis")
    .eq("id", id)
    .maybeSingle();

  if (personErr || !person) {
    return NextResponse.json({ error: "Workforce person not found" }, { status: 404 });
  }

  const profile = (person.payroll_profile ?? {}) as { email?: string };
  const email = profile.email?.trim();
  if (!email) {
    return NextResponse.json({ error: "Set work email on the person profile first" }, { status: 400 });
  }

  if (sendEmail && !person.payment_method) {
    return NextResponse.json(
      { error: "Set payment method in Finance before emailing the welcome invite" },
      { status: 400 },
    );
  }

  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const { data: requestRow, error: insErr } = await admin
    .from("workforce_onboarding_requests")
    .insert({
      payroll_internal_cost_id: id,
      custom_message: customMessage.trim() || null,
      requested_by: auth.user.id,
      sent_to_email: email,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();

  if (insErr || !requestRow) {
    return NextResponse.json({ error: insErr?.message ?? "Could not create onboarding request" }, { status: 500 });
  }

  const token = createWorkforceOnboardingToken({
    requestId: requestRow.id,
    payrollInternalCostId: id,
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
  const onboardingUrl = `${baseUrl}/onboard/${encodeURIComponent(token)}`;

  const { data: brandingRow } = await admin.from("company_settings").select("*").maybeSingle();
  const branding: CompanyBranding = {
    companyName: (brandingRow as { company_name?: string } | null)?.company_name ?? "Fixfy",
    address: (brandingRow as { address?: string } | null)?.address ?? "",
    phone: (brandingRow as { phone?: string } | null)?.phone ?? "",
    email: (brandingRow as { email?: string } | null)?.email ?? "",
    logoUrl: (brandingRow as { logo_url?: string } | null)?.logo_url ?? undefined,
    primaryColor: (brandingRow as { primary_color?: string } | null)?.primary_color ?? undefined,
    tagline: (brandingRow as { tagline?: string } | null)?.tagline ?? undefined,
  };

  const html = buildWorkforceWelcomeEmailHTML(branding, {
    personName: person.payee_name?.trim() || "there",
    onboardingUrl,
    expiresAt,
    customMessage,
  });

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!sendEmail || !resendKey) {
    return NextResponse.json({
      ok: true,
      onboardingUrl,
      requestId: requestRow.id,
      sentTo: sendEmail ? undefined : email,
      warning: sendEmail && !resendKey ? "RESEND_API_KEY not set — email not sent" : undefined,
    });
  }

  const resend = new Resend(resendKey);
  const from = process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM;
  const send = await resend.emails.send({
    from,
    to: email,
    subject: `Welcome to ${branding.companyName} — complete your onboarding`,
    html,
  });

  if (send.error) {
    return NextResponse.json({ error: send.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, onboardingUrl, requestId: requestRow.id, sentTo: email });
}
