/** Os números do painel ao vivo da campanha. Só admin. */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth-api";
import { painelDaCampanha } from "@/lib/marketing/campanha-painel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", auth.user.id).single();
  if ((profile as { role?: string } | null)?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json(await painelDaCampanha());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "falhou" }, { status: 500 });
  }
}
