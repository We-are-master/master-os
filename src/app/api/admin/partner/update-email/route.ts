import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuth, isValidUUID } from "@/lib/auth-api";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const supabase = await import("@/lib/supabase/server").then((m) => m.createClient());
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).single();
  if ((profile as { role?: string } | null)?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden", message: "Admin only" }, { status: 403 });
  }

  try {
    const { userId, newEmail } = await req.json();
    if (!userId || !newEmail || typeof newEmail !== "string") {
      return NextResponse.json({ error: "Missing userId or newEmail" }, { status: 400 });
    }
    if (!isValidUUID(userId)) {
      return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
    }
    const email = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    const admin = createServiceClient();
    const { data: user, error: updateError } = await admin.auth.admin.updateUserById(userId, { email });
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    await admin.from("profiles").update({ email, updated_at: new Date().toISOString() }).eq("id", userId);

    return NextResponse.json({ success: true, email: user?.user?.email });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update email" },
      { status: 500 }
    );
  }
}
