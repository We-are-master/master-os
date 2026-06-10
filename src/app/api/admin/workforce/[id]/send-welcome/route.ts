import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createWorkforceOnboardingToken } from "@/lib/workforce-onboarding-token";
import {
  buildWorkforceWelcomeEmailHTML,
  formatWorkforceWelcomeRole,
} from "@/lib/workforce-welcome-email-template";
import {
  loadWorkforceEmailBranding,
  sendWorkforcePlatformLoginInvite,
  sendWorkforceWelcomeEmail,
  workforcePlatformLoginUrl,
} from "@/lib/workforce-welcome-email-send";

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
    .select("id, payee_name, amount, pay_frequency, payroll_profile, payment_method, commission_enabled, commission_rate_percent, commission_basis, employment_type, description")
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

  const isEmployee = person.employment_type === "employee";

  if (isEmployee) {
    const platformLoginUrl = workforcePlatformLoginUrl(email);
    if (!sendEmail) {
      return NextResponse.json({
        ok: true,
        platformLoginUrl,
        sentTo: email,
      });
    }

    const sent = await sendWorkforcePlatformLoginInvite({
      admin,
      personName: person.payee_name?.trim() || "there",
      workEmail: email,
      employmentType: person.employment_type,
      description: person.description,
      customMessage,
    });

    if (!sent.ok) {
      if (sent.warning) {
        return NextResponse.json({ ok: true, platformLoginUrl, warning: sent.warning });
      }
      return NextResponse.json({ error: sent.error, platformLoginUrl }, { status: 500 });
    }

    return NextResponse.json({ ok: true, platformLoginUrl, sentTo: sent.sentTo });
  }

  if (sendEmail && !person.payment_method) {
    return NextResponse.json(
      { error: "Set payment method in Finance before emailing the welcome invite" },
      { status: 400 },
    );
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
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

  const branding = await loadWorkforceEmailBranding(admin);
  const role = formatWorkforceWelcomeRole(person.employment_type, person.description);

  const html = buildWorkforceWelcomeEmailHTML(branding, {
    personName: person.payee_name?.trim() || "there",
    workEmail: email,
    role,
    actionUrl: onboardingUrl,
    variant: "onboarding",
    customMessage,
  });

  if (!sendEmail) {
    return NextResponse.json({
      ok: true,
      onboardingUrl,
      requestId: requestRow.id,
      sentTo: email,
    });
  }

  const send = await sendWorkforceWelcomeEmail(email, html);
  if (!send.ok) {
    if (send.warning) {
      return NextResponse.json({ ok: true, onboardingUrl, requestId: requestRow.id, warning: send.warning });
    }
    return NextResponse.json({ error: send.error, onboardingUrl, requestId: requestRow.id }, { status: 500 });
  }

  return NextResponse.json({ ok: true, onboardingUrl, requestId: requestRow.id, sentTo: email });
}
