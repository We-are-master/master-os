import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { enviarEmailDeAtivacao } from "@/lib/partner-activation";

const STAFF_ROLES = new Set(["admin", "manager", "operator"]);

/** POST /api/partners/[id]/send-activated-email — notify partner their account is active. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { createClient: createServerSupabase } = await import("@/lib/supabase/server");
  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  const role = (profile as { role?: string } | null)?.role ?? "";
  if (!STAFF_ROLES.has(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!isValidUUID(id)) return NextResponse.json({ error: "Invalid partner id" }, { status: 400 });

  const r = await enviarEmailDeAtivacao(createServiceClient(), id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
