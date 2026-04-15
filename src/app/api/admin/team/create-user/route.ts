import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuth } from "@/lib/auth-api";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ROLES = new Set(["admin", "manager", "operator"]);

/**
 * Admin-only: create an internal auth user with an admin-set temporary
 * password. The user is flagged `must_change_password = true` so the
 * dashboard forces them to choose a new password on first login.
 *
 * Optionally links the newly created profile to an existing
 * payroll_internal_costs row (for when the Workforce page creates a
 * person and simultaneously grants app access).
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY on the server.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const supabase = await createClient();
  const { data: requester } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single();
  if ((requester as { role?: string } | null)?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden", message: "Admin only" }, { status: 403 });
  }

  let body: {
    email?: string;
    full_name?: string;
    role?: string;
    password?: string;
    payroll_internal_cost_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const full_name = String(body.full_name ?? "").trim();
  const role = String(body.role ?? "operator").trim() as "admin" | "manager" | "operator";
  const password = String(body.password ?? "");
  const payrollId = body.payroll_internal_cost_id
    ? String(body.payroll_internal_cost_id).trim()
    : null;

  if (!email || !full_name) {
    return NextResponse.json({ error: "Missing email or full_name" }, { status: 400 });
  }
  if (!ROLES.has(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }

  try {
    const admin = createServiceClient();

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role },
    });

    if (createErr) {
      const msg = createErr.message.toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        return NextResponse.json(
          { error: "This email is already registered. Remove the user from Auth first or use a different email." },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: createErr.message }, { status: 400 });
    }

    const user = created.user;
    if (!user?.id) {
      return NextResponse.json({ error: "Create did not return a user id" }, { status: 500 });
    }

    const now = new Date().toISOString();

    // Upsert profile with must_change_password flag set
    const { error: profileErr } = await admin
      .from("profiles")
      .upsert(
        {
          id: user.id,
          email: user.email ?? email,
          full_name,
          role,
          is_active: true,
          must_change_password: true,
          created_at: now,
          updated_at: now,
        },
        { onConflict: "id" },
      );

    if (profileErr) {
      // Auth user was created but profile insert failed — attempt to delete the auth user to roll back
      await admin.auth.admin.deleteUser(user.id).catch(() => {});
      return NextResponse.json(
        { error: `User creation failed: ${profileErr.message}` },
        { status: 500 },
      );
    }

    // Optionally link the new profile to an existing payroll row
    if (payrollId) {
      await admin
        .from("payroll_internal_costs")
        .update({
          profile_id: user.id,
          updated_at: now,
        })
        .eq("id", payrollId);
    }

    return NextResponse.json({
      success: true,
      userId: user.id,
      email: user.email,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "User creation failed";
    if (message.includes("Server config missing")) {
      return NextResponse.json(
        {
          error: "Server is not configured to create users. Add SUPABASE_SERVICE_ROLE_KEY to the deployment environment.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
