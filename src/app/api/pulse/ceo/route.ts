/** Os números do CEO para o Pulse: funil do mês, a receber, urgentes e as séries dos gráficos. */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
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
  if (!["admin", "manager"].includes(String(eu?.role ?? ""))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await montarPulseCeo(sb));
}
