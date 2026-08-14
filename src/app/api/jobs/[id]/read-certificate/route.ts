import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fillCertificateExpiry } from "@/lib/certificate-reader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Reading a scanned multi-page certificate is a slow call to make.
export const maxDuration = 60;

const ALLOWED_ROLES = new Set(["admin", "manager", "operator"]);

/**
 * POST /api/jobs/[id]/read-certificate   (session-authenticated)
 *
 * Reads the expiry date off the certificate attached to the final report.
 *
 * The save routes already do this on their own, after the response. This is the
 * door for the two cases they cannot cover: a report filed before any of this
 * existed, and a document the model failed to read the first time. It always
 * forces, because there is no reason to press the button otherwise.
 *
 * Unlike the automatic path, this one waits for the answer — someone is looking
 * at the button.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: "Invalid job id." }, { status: 400 });
  }

  const outcome = await fillCertificateExpiry(createServiceClient(), id, { force: true });

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.reason }, { status: 422 });
  }

  return NextResponse.json({
    ok: true,
    applied: outcome.applied,
    expiryDate: outcome.reading.expiry_date,
    confidence: outcome.reading.confidence,
  });
}
