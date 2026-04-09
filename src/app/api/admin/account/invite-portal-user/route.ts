import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient as createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ALLOWED_INVITER_ROLES = new Set(["admin", "manager"]);

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

  // Check no existing portal user with this email
  const { data: existing } = await admin
    .from("account_portal_users")
    .select("id, account_id")
    .ilike("email", email)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: "A portal user with this email already exists" },
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
          { error: "This email is already registered. Use a different email address." },
          { status: 409 },
        );
      }
      console.error("[invite-portal-user] inviteUserByEmail error:", error);
      return NextResponse.json(
        { error: "Could not send the invite. Please try again." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      userId: data?.user?.id ?? null,
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
