/** Live actions do Overview: GET devolve as últimas ações (36h), com hora e quem fez. */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { requireStaffPermission } from "@/lib/staff-permission";
import { createServiceClient } from "@/lib/supabase/service";
import { montarAcoesAoVivo } from "@/lib/pulse-live-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const sb = createServiceClient();
  const { data: eu } = await sb.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  // A mesma regra do Pulse: conta de parceiro é operator e não vê o histórico de todos.
  if (!["admin", "manager"].includes(String(eu?.role ?? ""))) {
    const permitido = await requireStaffPermission(auth, "finance");
    if (permitido instanceof NextResponse) return permitido;
  }
  return NextResponse.json({ acoes: await montarAcoesAoVivo(sb) });
}
