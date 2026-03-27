import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuth, isValidUUID } from "@/lib/auth-api";

/**
 * Ensures a row exists in `public.users` (mobile app profile) for an auth user.
 * RLS normally only allows self-insert; OS admins use the service role here.
 * Idempotent: updates email/name/company when the row already exists.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const supabase = await import("@/lib/supabase/server").then((m) => m.createClient());
  const { data: me } = await supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if ((me as { role?: string } | null)?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden", message: "Admin only" }, { status: 403 });
  }

  let admin;
  try {
    admin = createServiceClient();
  } catch (e) {
    return NextResponse.json(
      {
        error: "Server misconfigured",
        message: e instanceof Error ? e.message : "Missing SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY)",
      },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const partnerId = typeof body.partnerId === "string" ? body.partnerId.trim() : undefined;

    if (!userId || !isValidUUID(userId)) {
      return NextResponse.json({ error: "Invalid or missing userId" }, { status: 400 });
    }

    const { data: profile, error: profErr } = await admin
      .from("profiles")
      .select("id, email, full_name, avatar_url")
      .eq("id", userId)
      .maybeSingle();

    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 400 });
    }
    if (!profile) {
      return NextResponse.json({ error: "No profile for this user id" }, { status: 404 });
    }

    let companyName: string | null = null;
    let phone: string | null = null;
    if (partnerId && isValidUUID(partnerId)) {
      const { data: p } = await admin
        .from("partners")
        .select("company_name, phone")
        .eq("id", partnerId)
        .maybeSingle();
      companyName = (p as { company_name?: string } | null)?.company_name ?? null;
      phone = (p as { phone?: string } | null)?.phone ?? null;
    }

    const email = (profile as { email: string }).email?.trim() || "";
    const fullName = (profile as { full_name?: string }).full_name?.trim() || email.split("@")[0] || "User";
    const avatarUrl = (profile as { avatar_url?: string | null }).avatar_url ?? null;

    const { data: existing } = await admin.from("users").select("id").eq("id", userId).maybeSingle();

    const now = new Date().toISOString();

    if (existing) {
      const patch: Record<string, unknown> = {
        email,
        full_name: fullName,
        avatar_url: avatarUrl,
        updated_at: now,
      };
      if (companyName) patch.company_name = companyName;
      if (phone) patch.phone = phone;

      const { error: upErr } = await admin.from("users").update(patch).eq("id", userId);
      if (upErr) {
        return NextResponse.json({ error: upErr.message, code: upErr.code }, { status: 400 });
      }
      return NextResponse.json({ ok: true, action: "updated" });
    }

    const insert: Record<string, unknown> = {
      id: userId,
      email,
      full_name: fullName,
      avatar_url: avatarUrl ?? "",
      user_type: "external_partner",
      userActive: true,
      onboarding_completed: false,
      phone: phone ?? "",
      company_name: companyName,
      updated_at: now,
    };

    const { error: insErr } = await admin.from("users").insert(insert);
    if (insErr) {
      return NextResponse.json(
        { error: insErr.message, code: insErr.code, hint: "Ensure public.users exists (see docs/SQL_APP_SETUP.sql)" },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, action: "created" });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "sync-app-user failed" },
      { status: 500 }
    );
  }
}
