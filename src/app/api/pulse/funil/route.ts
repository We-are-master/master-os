/** Funil do Pulse no período do filtro: GET ?from=ISO&to=ISO. */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { montarFunilDoPeriodo } from "@/lib/pulse-ceo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const sb = createServiceClient();
  const { data: eu } = await sb.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!["admin", "manager"].includes(String(eu?.role ?? ""))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return NextResponse.json({ error: "from and to must be ISO dates" }, { status: 400 });
  }
  return NextResponse.json(await montarFunilDoPeriodo(sb, from, to));
}
