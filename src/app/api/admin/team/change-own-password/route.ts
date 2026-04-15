import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuth } from "@/lib/auth-api";

export const dynamic = "force-dynamic";

/**
 * Authenticated users change their own password. Clears the
 * `must_change_password` flag so the dashboard stops forcing the
 * password-reset modal.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  let body: { new_password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const newPassword = String(body.new_password ?? "");
  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }

  const admin = createServiceClient();

  const { error: pwErr } = await admin.auth.admin.updateUserById(auth.user.id, {
    password: newPassword,
  });
  if (pwErr) {
    return NextResponse.json({ error: pwErr.message }, { status: 500 });
  }

  const { error: flagErr } = await admin
    .from("profiles")
    .update({
      must_change_password: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", auth.user.id);
  if (flagErr) {
    return NextResponse.json({ error: flagErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
