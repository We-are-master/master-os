/** Os números do CEO para o Pulse: funil do mês, a receber, urgentes e as séries dos gráficos. */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { requireStaffPermission } from "@/lib/staff-permission";
import { createServiceClient } from "@/lib/supabase/service";
import { montarPulseCeo } from "@/lib/pulse-ceo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
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
  return NextResponse.json(await montarPulseCeo(sb));
}
