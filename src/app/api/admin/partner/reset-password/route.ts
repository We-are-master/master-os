import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuth, isValidUUID } from "@/lib/auth-api";

/** Generate a password reset link for the partner; they receive email from Supabase (or you can send the link manually). */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const supabase = await import("@/lib/supabase/server").then((m) => m.createClient());
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).single();
  if ((profile as { role?: string } | null)?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden", message: "Admin only" }, { status: 403 });
  }

  try {
    const { userId } = await req.json();
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    if (!isValidUUID(userId)) return NextResponse.json({ error: "Invalid userId" }, { status: 400 });

    const admin = createServiceClient();
    const { data: user } = await admin.auth.admin.getUserById(userId);
    if (!user?.user?.email) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { data: linkData, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: user.user.email,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const resetLink = (linkData as { properties?: { action_link?: string } } | null)?.properties?.action_link ?? null;

    return NextResponse.json({
      success: true,
      message: resetLink ? "Send this link to the partner to reset password." : "Recovery link generated.",
      reset_link: resetLink ?? undefined,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to generate reset link" },
      { status: 500 }
    );
  }
}
