/** A receber do Pulse no período do filtro: GET ?from=ISO&to=ISO (sem os dois = tudo em aberto + pago do mês). */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { requireStaffPermission } from "@/lib/staff-permission";
import { createServiceClient } from "@/lib/supabase/service";
import { montarReceberDoPeriodo } from "@/lib/pulse-ceo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const sb = createServiceClient();
  const { data: eu } = await sb.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  // Admin e manager sempre; os outros só com a permissão de finance (dono, 15/10/2026: o Leo vê
  // todos os números do Pulse). "dashboard" não serve: conta de parceiro é operator e já nasce com ele.
  if (!["admin", "manager"].includes(String(eu?.role ?? ""))) {
    const permitido = await requireStaffPermission(auth, "finance");
    if (permitido instanceof NextResponse) return permitido;
  }
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if ((from && Number.isNaN(Date.parse(from))) || (to && Number.isNaN(Date.parse(to)))) {
    return NextResponse.json({ error: "from and to must be ISO dates" }, { status: 400 });
  }
  return NextResponse.json(await montarReceberDoPeriodo(sb, from || null, to || null));
}
