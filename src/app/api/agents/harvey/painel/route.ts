/**
 * GET → o painel do Harvey (vendas, conversas paradas, pendências). Só equipe do escritório.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { lerPainelDoHarvey } from "@/lib/harvey-wa/painel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PODE_VER = new Set(["admin", "manager", "operator"]);

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const sb = createServiceClient();
  const { data: eu } = await sb.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (!PODE_VER.has(String(eu?.role ?? ""))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await lerPainelDoHarvey(sb));
}
