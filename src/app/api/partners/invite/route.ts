import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createPartnerPortalLink } from "@/lib/partner-portal-link";
import { resolvePartnerTradePortalBaseUrl } from "@/lib/trade-auth";
import { COVERAGE_CITY_LONDON_ID, defaultLondonIncludedPostcodes } from "@/lib/coverage-cities";
import { GENERAL_MAINTENANCE_LABEL } from "@/lib/type-of-work";
import { PARTNER_RATING_MAX } from "@/lib/partner-rating";

const STAFF_ROLES = new Set(["admin", "manager", "operator"]);

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const phone = raw.trim();
  return phone.length > 0 ? phone.slice(0, 40) : null;
}

function normalizePartnerName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ").slice(0, 120);
  return name.length > 0 ? name : null;
}

export async function POST(req: NextRequest) {
  try {
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
      return NextResponse.json({ error: "Forbidden", message: "Staff role required" }, { status: 403 });
    }

    let body: { name?: unknown; email?: unknown; phone?: unknown; sendEmail?: unknown } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const name = normalizePartnerName(body.name);
    if (!name) {
      return NextResponse.json({ error: "Partner name is required" }, { status: 400 });
    }

    const email = normalizeEmail(body.email);
    if (!email) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
    }

    const phone = normalizePhone(body.phone);
    const sendEmail = body.sendEmail !== false;
    const supabase = createServiceClient();

    const { data: existingRows, error: lookupErr } = await supabase
      .from("partners")
      .select("id, email, phone, status, auth_user_id, company_name, contact_name")
      .ilike("email", email)
      .limit(1);

    if (lookupErr) {
      return NextResponse.json({ error: lookupErr.message ?? "Lookup failed" }, { status: 500 });
    }

    const existing = (existingRows?.[0] ?? null) as {
      id: string;
      email?: string | null;
      phone?: string | null;
      status?: string | null;
      auth_user_id?: string | null;
      company_name?: string | null;
      contact_name?: string | null;
    } | null;

    let partnerId: string;
    let created = false;
    let resent = false;

    if (existing?.id) {
      if (existing.auth_user_id?.trim()) {
        return NextResponse.json(
          {
            error: "This email already has a Trade Portal account. Open the partner in Directory instead.",
          },
          { status: 409 },
        );
      }
      partnerId = existing.id;
      resent = true;
      const patch: Record<string, unknown> = {};
      if (phone && phone !== (existing.phone?.trim() ?? "")) patch.phone = phone;
      if (existing.status !== "onboarding") patch.status = "onboarding";
      if (name !== (existing.contact_name?.trim() ?? "")) {
        patch.contact_name = name;
        if (!(existing.company_name?.trim() ?? "")) patch.company_name = name;
      }
      if (Object.keys(patch).length > 0) {
        await supabase.from("partners").update(patch).eq("id", partnerId);
      }
    } else {
      const insertRow = {
        company_name: name,
        contact_name: name,
        email,
        phone,
        trade: GENERAL_MAINTENANCE_LABEL,
        trades: [GENERAL_MAINTENANCE_LABEL],
        status: "onboarding",
        verified: false,
        partner_legal_type: "self_employed",
        location: "London",
        coverage_mode: "postcodes",
        included_postcodes: defaultLondonIncludedPostcodes(),
        coverage_cities: [COVERAGE_CITY_LONDON_ID],
        rating: PARTNER_RATING_MAX,
      };

      const { data: createdRow, error: insertErr } = await supabase
        .from("partners")
        .insert(insertRow)
        .select("id")
        .single();

      if (insertErr) {
        const code = (insertErr as { code?: string }).code ?? "";
        if (code === "23505") {
          return NextResponse.json(
            { error: "A partner with this email already exists. Search Directory for that email." },
            { status: 409 },
          );
        }
        return NextResponse.json({ error: insertErr.message ?? "Could not create partner" }, { status: 500 });
      }

      partnerId = (createdRow as { id: string }).id;
      created = true;
    }

    const osBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || req.nextUrl.origin;
    const tradePortalBaseUrl = resolvePartnerTradePortalBaseUrl();

    const link = await createPartnerPortalLink(supabase, {
      partnerId,
      sendEmail,
      requestedDocIds: null,
      requestedByUserId: auth.user.id,
      osBaseUrl,
      tradePortalBaseUrl,
      linkKind: "trade_onboarding",
    });

    return NextResponse.json({
      ok: true,
      partnerId,
      created,
      resent,
      email,
      onboardingUrl: link.onboardingUrl,
      fullUrl: link.fullUrl,
      sentTo: link.sentTo ?? email,
      emailSent: Boolean(link.emailSent),
      emailError: link.emailError ?? null,
      warning: link.warning,
      expiresAt: link.expiresAt,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    console.error("[partners/invite] unhandled", e);
    return NextResponse.json({ error: message || "Invite failed" }, { status: 500 });
  }
}
