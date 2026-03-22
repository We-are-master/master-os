import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuth } from "@/lib/auth-api";
import { createClient } from "@/lib/supabase/server";

const ROLES = new Set(["admin", "manager", "operator"]);

/**
 * Admin-only: send Supabase invite email and ensure a `profiles` row exists.
 * Requires SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE_KEY on the server.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).single();
  if ((profile as { role?: string } | null)?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden", message: "Admin only" }, { status: 403 });
  }

  let body: { email?: string; full_name?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  const full_name = String(body.full_name ?? "").trim();
  const role = String(body.role ?? "operator").trim() as "admin" | "manager" | "operator";

  if (!email || !full_name) {
    return NextResponse.json({ error: "Missing email or full_name" }, { status: 400 });
  }
  if (!ROLES.has(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  try {
    const admin = createServiceClient();
    const origin = req.headers.get("origin")?.trim();
    const refererBase = req.headers.get("referer")?.match(/^https?:\/\/[^/]+/)?.[0];
    const base =
      process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") ||
      origin?.replace(/\/$/, "") ||
      refererBase ||
      "http://localhost:3000";

    const redirectTo = `${base}/login`;

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name, role },
      redirectTo,
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        return NextResponse.json(
          { error: "This email is already registered. Remove the user from Auth first or use a different email." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const user = data.user;
    if (!user?.id) {
      return NextResponse.json({ error: "Invite did not return a user id" }, { status: 500 });
    }

    const now = new Date().toISOString();
    const rowEmail = user.email ?? email;

    const { data: existing } = await admin.from("profiles").select("id").eq("id", user.id).maybeSingle();

    if (existing) {
      const { error: uErr } = await admin
        .from("profiles")
        .update({
          email: rowEmail,
          full_name,
          role,
          is_active: true,
          updated_at: now,
        })
        .eq("id", user.id);
      if (uErr) {
        return NextResponse.json(
          { error: `Invite sent but profile update failed: ${uErr.message}` },
          { status: 500 }
        );
      }
    } else {
      const { error: iErr } = await admin.from("profiles").insert({
        id: user.id,
        email: rowEmail,
        full_name,
        role,
        is_active: true,
        created_at: now,
        updated_at: now,
      });
      if (iErr) {
        return NextResponse.json(
          { error: `Invite sent but profile insert failed: ${iErr.message}. Ensure a profiles row is allowed for new auth users.` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true, userId: user.id });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invite failed";
    if (message.includes("Server config missing")) {
      return NextResponse.json(
        {
          error: "Server is not configured for invites. Add SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY) to the deployment environment.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
