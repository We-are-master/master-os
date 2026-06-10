import "server-only";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyBranding } from "@/lib/pdf/quote-template";
import {
  buildWorkforceWelcomeEmailHTML,
  formatWorkforceWelcomeRole,
  type WorkforceWelcomeEmailOptions,
} from "@/lib/workforce-welcome-email-template";

const DEFAULT_FROM = "Fixfy <support@getfixfy.com>";
const WELCOME_SUBJECT = "Welcome to the Fixfy Operating System";

export function workforcePlatformLoginUrl(workEmail: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
  const email = workEmail.trim().toLowerCase();
  return `${baseUrl}/login?email=${encodeURIComponent(email)}`;
}

export async function loadWorkforceEmailBranding(
  admin: SupabaseClient,
): Promise<CompanyBranding> {
  const { data: brandingRow } = await admin.from("company_settings").select("*").maybeSingle();
  return {
    companyName: (brandingRow as { company_name?: string } | null)?.company_name ?? "Fixfy",
    address: (brandingRow as { address?: string } | null)?.address ?? "",
    phone: (brandingRow as { phone?: string } | null)?.phone ?? "",
    email: (brandingRow as { email?: string } | null)?.email ?? "",
    logoUrl: (brandingRow as { logo_url?: string } | null)?.logo_url ?? undefined,
    primaryColor: (brandingRow as { primary_color?: string } | null)?.primary_color ?? undefined,
    tagline: (brandingRow as { tagline?: string } | null)?.tagline ?? undefined,
  };
}

export async function sendWorkforceWelcomeEmail(
  to: string,
  html: string,
): Promise<{ ok: true } | { ok: false; error: string; warning?: string }> {
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    return { ok: false, error: "RESEND_API_KEY not set", warning: "RESEND_API_KEY not set — email not sent" };
  }

  const resend = new Resend(resendKey);
  const from = process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM;
  const send = await resend.emails.send({
    from,
    to,
    subject: WELCOME_SUBJECT,
    html,
  });

  if (send.error) {
    return { ok: false, error: send.error.message };
  }

  return { ok: true };
}

export async function sendWorkforcePlatformLoginInvite(args: {
  admin: SupabaseClient;
  personName: string;
  workEmail: string;
  employmentType: string | null | undefined;
  description: string | null | undefined;
  customMessage?: string;
}): Promise<{ ok: true; sentTo: string } | { ok: false; error: string; warning?: string }> {
  const workEmail = args.workEmail.trim().toLowerCase();
  if (!workEmail.includes("@")) {
    return { ok: false, error: "Valid work email is required" };
  }

  const branding = await loadWorkforceEmailBranding(args.admin);
  const role = formatWorkforceWelcomeRole(args.employmentType, args.description);
  const htmlOptions: WorkforceWelcomeEmailOptions = {
    personName: args.personName,
    workEmail,
    role,
    actionUrl: workforcePlatformLoginUrl(workEmail),
    variant: "platform_login",
    customMessage: args.customMessage,
  };

  const html = buildWorkforceWelcomeEmailHTML(branding, htmlOptions);
  const sent = await sendWorkforceWelcomeEmail(workEmail, html);
  if (!sent.ok) {
    return { ok: false, error: sent.error, warning: sent.warning };
  }
  return { ok: true, sentTo: workEmail };
}
