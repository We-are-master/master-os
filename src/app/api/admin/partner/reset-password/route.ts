import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/** Generate a password reset link for the partner; they receive email from Supabase (or you can send the link manually). */
export async function POST(req: NextRequest) {
  // Rate limit per IP — defense against admin-token-stuffing brute force.
  const ip = getClientIp(req);
  const rl = checkRateLimit(`reset-pw:${ip}`, 3, 10 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many reset attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const supabase = await import("@/lib/supabase/server").then((m) => m.createClient());
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).single();
  if ((profile as { role?: string } | null)?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden", message: "Admin only" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as { userId?: string; new_password?: string };
    const userId = body.userId;
    const newPassword = typeof body.new_password === "string" ? body.new_password : null;
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    if (!isValidUUID(userId)) return NextResponse.json({ error: "Invalid userId" }, { status: 400 });

    const admin = createServiceClient();
    const { data: user } = await admin.auth.admin.getUserById(userId);
    if (!user?.user?.email) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Admin is setting the password directly (preferred for partners —
    // they can sign in to the mobile app immediately with the new pass).
    if (newPassword !== null) {
      if (newPassword.length < 8) {
        return NextResponse.json(
          { error: "Password must be at least 8 characters" },
          { status: 400 },
        );
      }
      const { error: pwErr } = await admin.auth.admin.updateUserById(userId, {
        password: newPassword,
      });
      if (pwErr) {
        console.error("[reset-password] set password failed:", pwErr);
        return NextResponse.json(
          { error: `Failed to set password: ${pwErr.message}` },
          { status: 500 },
        );
      }
      return NextResponse.json({
        success: true,
        message: "Password updated. Share the new password with the partner.",
      });
    }

    // Otherwise: generate a recovery link the admin can send manually.
    const { data: linkData, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: user.user.email,
    });
    if (error) {
      console.error("[reset-password] generateLink failed:", error);
      return NextResponse.json({ error: "Failed to generate reset link" }, { status: 400 });
    }

    const resetLink = (linkData as { properties?: { action_link?: string } } | null)?.properties?.action_link ?? null;

    return NextResponse.json({
      success: true,
      message: resetLink ? "Send this link to the partner to reset password." : "Recovery link generated.",
      reset_link: resetLink ?? undefined,
    });
  } catch (e) {
    console.error("[reset-password] unexpected error:", e);
    return NextResponse.json(
      { error: "Failed to generate reset link" },
      { status: 500 }
    );
  }
}
