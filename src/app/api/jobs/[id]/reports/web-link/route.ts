import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { linkDoReportWeb } from "@/lib/fatura-semanal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_ROLES = new Set(["admin", "manager", "operator", "viewer"]);

/**
 * GET /api/jobs/[id]/reports/web-link → { url } do report na web (/report/[token]).
 *
 * Assinado AQUI, no servidor que vai abrir o link: o token é HMAC do segredo do
 * ambiente, e um link gerado no localhost não abre em app.getfixfy.com.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const serverSupabase = await createServerSupabase();
  const { data: profile } = await serverSupabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!ALLOWED_ROLES.has((profile as { role?: string } | null)?.role ?? "")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  if (!isValidUUID(id)) return NextResponse.json({ error: "Invalid job id" }, { status: 400 });
  return NextResponse.json({ url: linkDoReportWeb(id) });
}
