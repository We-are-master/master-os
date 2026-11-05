/** De onde vem a receita: GET ?period=month|year (padrão month). Canais e as 5 maiores contas dos mesmos jobs. */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { requireStaffPermission } from "@/lib/staff-permission";
import { createServiceClient } from "@/lib/supabase/service";
import { montarMixDaReceita } from "@/lib/pulse-revenue-mix";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const sb = createServiceClient();
  const { data: eu } = await sb.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!["admin", "manager"].includes(String(eu?.role ?? ""))) {
    const permitido = await requireStaffPermission(auth, "finance");
    if (permitido instanceof NextResponse) return permitido;
  }
  const periodo = req.nextUrl.searchParams.get("period") === "year" ? "year" : "month";
  return NextResponse.json(await montarMixDaReceita(sb, periodo));
}
