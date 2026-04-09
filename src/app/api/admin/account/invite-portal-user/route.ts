import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient as createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ALLOWED_INVITER_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * POST /api/admin/account/invite-portal-user
 * Body: { accountId: string, email: string, full_name: string }
 *
 * Admin / manager-only. Sends a Supabase magic-link invite to the email
 * with user_type=account_portal and account_id baked into the auth
 * metadata. The handle_new_account_portal_user trigger from migration
 * 131 then auto-creates the public.account_portal_users row.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  // Role gate
  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!ALLOWED_INVITER_ROLES.has(role)) {
    return NextResponse.json(
      { error: "Forbidden", message: "Admin or manager required" },
      { status: 403 },
    );
  }

  let body: { accountId?: unknown; email?: unknown; full_name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
  const email     = typeof body.email     === "string" ? body.email.trim().toLowerCase() : "";
  const fullName  = typeof body.full_name === "string" ? body.full_name.trim() : "";

  if (!isValidUUID(accountId)) {
    return NextResponse.json({ error: "Invalid account id" }, { status: 400 });
  }
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }
  if (!fullName) {
    return NextResponse.json({ error: "Full name is required" }, { status: 400 });
  }

  const admin = createServiceClient();

  // Check the account exists
  const { data: account } = await admin
    .from("accounts")
    .select("id, company_name")
    .eq("id", accountId)
    .maybeSingle();
  if (!account) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  // Check the email isn't already in use anywhere — defeats the silent
  // failure where inviteUserByEmail() reuses an existing auth user (e.g.
  // an internal staff profile) and the trigger does NOT fire because no
  // INSERT happens, leaving the would-be portal user with no
  // account_portal_users row.
  const [existingPortal, existingProfile, existingAppUser] = await Promise.all([
    admin
      .from("account_portal_users")
      .select("id")
      .ilike("email", email)
      .maybeSingle(),
    admin
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .maybeSingle(),
    admin
      .from("users")
      .select("id")
      .ilike("email", email)
      .maybeSingle(),
  ]);

  if (existingPortal.data) {
    return NextResponse.json(
      { error: "A portal user with this email already exists." },
      { status: 409 },
    );
  }
  if (existingProfile.data) {
    return NextResponse.json(
      {
        error:
          "This email belongs to an internal staff member. Use a different email for the portal — a single email cannot be both staff and a portal user.",
      },
      { status: 409 },
    );
  }
  if (existingAppUser.data) {
    return NextResponse.json(
      {
        error:
          "This email is already registered as a partner app user. Use a different email for the portal.",
      },
      { status: 409 },
    );
  }

  // Send the Supabase magic-link invite. The metadata fields are picked up
  // by handle_new_account_portal_user (migration 131) which writes the
  // account_portal_users row.
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") ||
    "http://localhost:3000";

  try {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: {
        user_type:  "account_portal",
        account_id: accountId,
        full_name:  fullName,
        invited_by: auth.user.id,
      },
      redirectTo: `${appUrl}/portal/auth/callback`,
    });

    if (error) {
      const msg = (error.message ?? "").toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        return NextResponse.json(
          { error: "This email is already registered in our auth system. Use a different email address." },
          { status: 409 },
        );
      }
      console.error("[invite-portal-user] inviteUserByEmail error:", error);
      return NextResponse.json(
        { error: "Could not send the invite. Please try again." },
        { status: 500 },
      );
    }

    const newUserId = data?.user?.id;
    if (!newUserId) {
      console.error("[invite-portal-user] inviteUserByEmail returned no user id");
      return NextResponse.json(
        { error: "The invite did not return a user id. Please try again." },
        { status: 500 },
      );
    }

    // Defensive: the trigger handle_new_account_portal_user (migration 131)
    // SHOULD have created the account_portal_users row from raw_user_meta_data.
    // If it didn't (trigger missing in this DB, RLS surprise, etc.), insert
    // the row directly so the portal user is functional immediately.
    const { data: existing } = await admin
      .from("account_portal_users")
      .select("id")
      .eq("id", newUserId)
      .maybeSingle();

    if (!existing) {
      const { error: insErr } = await admin
        .from("account_portal_users")
        .insert({
          id:         newUserId,
          account_id: accountId,
          email,
          full_name:  fullName,
          invited_by: auth.user.id,
          is_active:  true,
        });
      if (insErr) {
        console.error("[invite-portal-user] portal user row insert failed:", insErr);
        // Don't fail the whole invite — the trigger may still create it
        // asynchronously. But warn the caller.
        return NextResponse.json({
          ok: true,
          userId: newUserId,
          warning: "Invite sent but the portal user row could not be created automatically. Apply migration 131 in the database.",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      userId: newUserId,
      message: `Invite sent to ${email}.`,
    });
  } catch (err) {
    console.error("[invite-portal-user] unexpected error:", err);
    return NextResponse.json(
      { error: "Could not send the invite. Please try again." },
      { status: 500 },
    );
  }
}
