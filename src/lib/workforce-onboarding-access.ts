import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Creates or updates dashboard access for a workforce member finishing onboarding.
 * Links auth user → profiles → payroll_internal_costs when missing.
 */
export async function ensureWorkforceDashboardAccess(
  admin: SupabaseClient,
  args: {
    payrollInternalCostId: string;
    profileId: string | null;
    payeeName: string | null;
    payrollProfile: Record<string, unknown> | null;
    password: string;
  },
): Promise<{ profileId: string; email: string }> {
  const email = String(args.payrollProfile?.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new Error("Work email is required before accessing the platform");
  }
  if (args.password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  const fullName = (args.payeeName ?? "").trim() || "Team member";
  const now = new Date().toISOString();

  const upsertProfile = async (userId: string) => {
    const { error: profileErr } = await admin.from("profiles").upsert(
      {
        id: userId,
        email,
        full_name: fullName,
        role: "operator",
        is_active: true,
        must_change_password: false,
        workforce_refresh_required: false,
        session_valid_after: null,
        updated_at: now,
      },
      { onConflict: "id" },
    );
    if (profileErr) throw new Error(profileErr.message);

    const { error: linkErr } = await admin
      .from("payroll_internal_costs")
      .update({ profile_id: userId, updated_at: now })
      .eq("id", args.payrollInternalCostId);
    if (linkErr) throw new Error(linkErr.message);
  };

  if (args.profileId) {
    const { error } = await admin.auth.admin.updateUserById(args.profileId, {
      password: args.password,
      email,
    });
    if (error) throw new Error(error.message);
    await upsertProfile(args.profileId);
    return { profileId: args.profileId, email };
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: args.password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role: "operator" },
  });

  if (createErr) {
    const msg = createErr.message.toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      throw new Error(
        "This email is already registered. Contact your admin to link your dashboard access, or sign in at /login.",
      );
    }
    throw new Error(createErr.message);
  }

  const userId = created.user?.id;
  if (!userId) throw new Error("User creation did not return an id");

  await upsertProfile(userId);
  return { profileId: userId, email };
}
