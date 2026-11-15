/**
 * Faturas vencidas para cobrar à mão (Overview → Action required, 05/11/2026). A mesma regra
 * do card Cash: saldo em aberto, vencimento antes de hoje (Londres), plataformas fora porque
 * pagam no ciclo delas. Cada uma traz o estágio da cobrança para o botão dizer qual é a próxima.
 * A lista mora em `@/lib/invoice-overdue-list`, a mesma que o JARVIS lê.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { requireStaffPermission } from "@/lib/staff-permission";
import { createServiceClient } from "@/lib/supabase/service";
import { londonTodayYmd } from "@/lib/invoice-overdue-reminders";
import { listarFaturasVencidas } from "@/lib/invoice-overdue-list";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const sb = createServiceClient();
  const { data: eu } = await sb.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!["admin", "manager"].includes(String(eu?.role ?? ""))) {
    const permitido = await requireStaffPermission(auth, "finance");
    if (permitido instanceof NextResponse) return permitido;
  }
  const faturas = await listarFaturasVencidas(sb, londonTodayYmd());
  return NextResponse.json({ invoices: faturas });
}
