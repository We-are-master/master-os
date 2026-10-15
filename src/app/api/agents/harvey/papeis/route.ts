/**
 * Papéis da equipe (tela /agents/harvey): quem é o responsável de operação, quem assina
 * os e-mails de chase e quem assina o aviso de cotação. Só admin. Vale em até 60 s.
 *
 *   GET  → os agentes do Zendesk para o dropdown e os papéis atuais
 *   POST → { operacao: id, autor_emails: id, autor_aviso_cotacao: id }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { isZendeskConfigured, zendeskApi } from "@/lib/zendesk";
import { CHAVE_DOS_PAPEIS, lerPapeis, PAPEIS, validarPapeis, type PapeisDaEquipe } from "@/lib/responsavel-operacao";

export const dynamic = "force-dynamic";

type AgenteZd = { id: number; name: string; email: string | null; role: string; active?: boolean; suspended?: boolean };

async function soAdmin(): Promise<{ quem: string } | NextResponse> {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { data: eu } = await createServiceClient().from("profiles").select("role, full_name, email").eq("id", auth.user.id).maybeSingle();
  if (eu?.role !== "admin") return NextResponse.json({ error: "Only admins can change team roles" }, { status: 403 });
  return { quem: String(eu?.full_name || eu?.email || "team") };
}

/** Agentes e admins ativos do Zendesk (até 300, por nome). */
async function agentesDoZendesk(): Promise<AgenteZd[]> {
  if (!isZendeskConfigured()) return [];
  const todos: AgenteZd[] = [];
  let caminho: string | null = "users.json?role[]=agent&role[]=admin&per_page=100";
  for (let pagina = 0; caminho && pagina < 3; pagina++) {
    const r: { users?: AgenteZd[]; next_page?: string | null } = await zendeskApi(caminho);
    todos.push(...(r.users ?? []));
    caminho = r.next_page ? r.next_page.replace(/^.*\/api\/v2\//, "") : null;
  }
  return todos
    .filter((u) => u.active !== false && !u.suspended)
    .map((u) => ({ id: u.id, name: u.name, email: u.email ?? null, role: u.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET() {
  const ok = await soAdmin();
  if (ok instanceof NextResponse) return ok;
  try {
    const [agentes, papeis] = await Promise.all([agentesDoZendesk(), lerPapeis(createServiceClient())]);
    return NextResponse.json({ agentes, papeis });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ok = await soAdmin();
  if (ok instanceof NextResponse) return ok;
  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // O nome sai do Zendesk, não do navegador: só id de agente de verdade entra.
  const agentes = await agentesDoZendesk().catch(() => [] as AgenteZd[]);
  const porId = new Map(agentes.map((a) => [a.id, a]));
  const novo: Partial<PapeisDaEquipe> = {};
  for (const papel of PAPEIS) {
    const id = Number(corpo[papel]);
    const a = porId.get(id);
    if (!a) return NextResponse.json({ error: `Pick a Zendesk agent for ${papel}` }, { status: 400 });
    novo[papel] = { zendesk_user_id: a.id, nome: a.name };
  }
  const papeis = validarPapeis(novo);
  const { error } = await createServiceClient().from("harvey_wa_config").upsert({
    chave: CHAVE_DOS_PAPEIS,
    valor: papeis,
    atualizado_em: new Date().toISOString(),
    atualizado_por: ok.quem,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, papeis });
}
