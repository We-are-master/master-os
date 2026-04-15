import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ROLES = new Set(["admin", "manager", "operator"]);

async function requireAdmin(): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return { ok: false, response: auth };
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single();
  if ((data as { role?: string } | null)?.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, userId: auth.user.id };
}

/**
 * Admin-only: update role, active state, or reset password for a profile.
 * Body: { role?, is_active?, new_password? }
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: {
    role?: string;
    is_active?: boolean;
    full_name?: string;
    new_password?: string;
    email?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const admin = createServiceClient();
  const updates: Record<string, unknown> = {};
  if (typeof body.role === "string") {
    if (!ROLES.has(body.role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    updates.role = body.role;
  }
  if (typeof body.is_active === "boolean") updates.is_active = body.is_active;
  if (typeof body.full_name === "string" && body.full_name.trim()) {
    updates.full_name = body.full_name.trim();
  }

  // Email change — propagate to both auth.users and profiles so the user
  // can sign in with the new address. Do auth first: if it fails (e.g.
  // email already taken by another user), we abort before touching
  // profiles to keep the two in sync.
  if (typeof body.email === "string") {
    const cleanEmail = body.email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }
    const { error: emailErr } = await admin.auth.admin.updateUserById(id, {
      email: cleanEmail,
      email_confirm: true,
    });
    if (emailErr) {
      const msg = emailErr.message.toLowerCase();
      if (msg.includes("already") || msg.includes("registered")) {
        return NextResponse.json(
          { error: "That email is already used by another account." },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: `Failed to change email: ${emailErr.message}` },
        { status: 500 },
      );
    }
    updates.email = cleanEmail;
  }

  // Reset password via Supabase Auth Admin API — also sets must_change_password
  if (typeof body.new_password === "string") {
    if (body.new_password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 },
      );
    }
    const { error: pwErr } = await admin.auth.admin.updateUserById(id, {
      password: body.new_password,
    });
    if (pwErr) {
      return NextResponse.json(
        { error: `Failed to reset password: ${pwErr.message}` },
        { status: 500 },
      );
    }
    updates.must_change_password = true;
  }

  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();
    const { error } = await admin.from("profiles").update(updates).eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}

/**
 * Admin-only soft delete: sets profile is_active=false (auth user kept so
 * historical references stay intact). A hard delete would break FK
 * references on jobs/quotes/audit logs.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  if (id === gate.userId) {
    return NextResponse.json(
      { error: "You cannot deactivate your own account" },
      { status: 400 },
    );
  }

  const admin = createServiceClient();
  const { error } = await admin
    .from("profiles")
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
