import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { assertPartnerLoginTarget, requireStaffPermission } from "@/lib/staff-permission";

/** Get partner email and return a mailto link or payload for your email provider. No actual send unless you integrate Resend/SendGrid. */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const gate = await requireStaffPermission(auth, "manage_partners");
  if (gate instanceof NextResponse) return gate;

  try {
    const { userId, subject, body } = await req.json();
    if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    if (!isValidUUID(userId)) return NextResponse.json({ error: "Invalid userId" }, { status: 400 });

    const admin = createServiceClient();
    if (gate.role !== "admin") {
      const denied = await assertPartnerLoginTarget(admin, userId);
      if (denied) return denied;
    }
    const { data: user } = await admin.auth.admin.getUserById(userId);
    const email = user?.user?.email ?? null;
    if (!email) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const sub = typeof subject === "string" ? subject.trim() : "";
    const b = typeof body === "string" ? body.trim() : "";
    const mailto = `mailto:${encodeURIComponent(email)}${sub ? `?subject=${encodeURIComponent(sub)}` : ""}${b ? `${sub ? "&" : "?"}body=${encodeURIComponent(b)}` : ""}`;

    return NextResponse.json({
      success: true,
      email,
      mailto,
      message: "Use mailto to open default mail client, or integrate Resend/SendGrid to send programmatically.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed" },
      { status: 500 }
    );
  }
}
