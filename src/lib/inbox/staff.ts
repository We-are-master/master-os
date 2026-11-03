/**
 * Quem pode mexer na /inbox pelas rotas: a equipe (admin, manager, operator).
 * Devolve o cliente service role já aberto e o nome que vai na mensagem.
 */

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";

const STAFF = new Set(["admin", "manager", "operator"]);

export async function staffDaInbox(): Promise<NextResponse | { sb: SupabaseClient; userId: string; nome: string }> {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const sb = createServiceClient();
  const { data: perfil } = await sb.from("profiles").select("role, full_name, email").eq("id", auth.user.id).maybeSingle();
  if (!STAFF.has(String(perfil?.role ?? ""))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return { sb, userId: auth.user.id, nome: String(perfil?.full_name || perfil?.email || "Team") };
}
