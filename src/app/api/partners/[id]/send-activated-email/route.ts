import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import {
  buildPartnerAccountActivatedEmailHTML,
  PARTNER_ACCOUNT_ACTIVATED_SUBJECT,
} from "@/lib/partner-account-activated-email";
import { resolvePartnerTradePortalBaseUrl } from "@/lib/trade-auth";
import type { CompanyBranding } from "@/lib/pdf/quote-template";

const STAFF_ROLES = new Set(["admin", "manager", "operator"]);
const DEFAULT_FROM_EMAIL = "Fixfy <support@getfixfy.com>";

async function loadCompanyBranding(supabase: ReturnType<typeof createServiceClient>): Promise<CompanyBranding> {
  try {
    const { data: settings } = await supabase.from("company_settings").select("*").limit(1).single();
    const s = (settings ?? {}) as Record<string, unknown>;
    return {
      companyName: String(s.company_name ?? "Fixfy"),
      logoUrl: s.logo_url ? String(s.logo_url) : undefined,
      address: String(s.address ?? "124 City Road, London, UK"),
      phone: String(s.phone ?? ""),
      email: String(s.email ?? "support@getfixfy.com"),
      website: s.website ? String(s.website) : undefined,
      vatNumber: s.vat_number ? String(s.vat_number) : undefined,
      primaryColor: String(s.primary_color ?? "#F97316"),
      tagline: s.tagline ? String(s.tagline) : undefined,
    };
  } catch {
    return {
      companyName: "Fixfy",
      address: "124 City Road, London, UK",
      phone: "",
      email: "support@getfixfy.com",
      primaryColor: "#F97316",
    };
  }
}

/** POST /api/partners/[id]/send-activated-email — notify partner their account is active. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { createClient: createServerSupabase } = await import("@/lib/supabase/server");
  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!STAFF_ROLES.has(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return NextResponse.json({ error: "Invalid partner id" }, { status: 400 });

  const supabase = createServiceClient();
  const { data: partner, error } = await supabase
    .from("partners")
    .select("id, email, contact_name, company_name, status, account_type")
    .eq("id", id)
    .maybeSingle();
  if (error || !partner) return NextResponse.json({ error: "Partner not found" }, { status: 404 });

  const email = (partner as { email?: string | null }).email?.trim() ?? "";
  if (!email) {
    return NextResponse.json({ error: "Partner has no email on file." }, { status: 422 });
  }

  const contactName =
    (partner as { contact_name?: string | null }).contact_name?.trim() ||
    (partner as { company_name?: string | null }).company_name?.trim() ||
    "there";

  const tradePortalBase = resolvePartnerTradePortalBaseUrl().replace(/\/$/, "");
  const loginUrl = `${tradePortalBase}/login?email=${encodeURIComponent(email)}`;
  const branding = await loadCompanyBranding(supabase);
  const rawAccountType = (partner as { account_type?: string | null }).account_type ?? null;
  const accountType =
    rawAccountType === "subscription" || rawAccountType === "free" ? rawAccountType : null;
  const html = buildPartnerAccountActivatedEmailHTML(branding, {
    contactName,
    email,
    loginUrl,
    accountType,
  });

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    return NextResponse.json({ ok: true, warning: "RESEND_API_KEY not set — email not sent", loginUrl });
  }

  try {
    const resend = new Resend(resendKey);
    const fromEmail = process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM_EMAIL;
    const { error: sendErr } = await resend.emails.send({
      from: fromEmail,
      to: [email],
      subject: PARTNER_ACCOUNT_ACTIVATED_SUBJECT,
      html,
    });
    if (sendErr) {
      return NextResponse.json({ error: sendErr.message ?? "Email send failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, sentTo: email });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Email send failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
