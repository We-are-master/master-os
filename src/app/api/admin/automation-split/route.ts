/** Divisão Harvey / sistema / humano dos últimos N dias (Fase 5). Admin e manager. */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { alertasDeAutomacao, medirDivisao } from "@/lib/divisao-automacao";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const sb = createServiceClient();
  const { data: eu } = await sb.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!["admin", "manager"].includes(String(eu?.role ?? ""))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const dias = Math.min(90, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 7));
  const [divisao, alertas] = await Promise.all([medirDivisao(sb, dias), alertasDeAutomacao(sb)]);
  return NextResponse.json({ divisao, alertas });
}
