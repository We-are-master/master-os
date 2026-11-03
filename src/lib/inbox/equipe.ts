/**
 * Quem pode assumir conversa na /inbox: só quem está ativo no Workforce
 * (payroll_internal_costs, fora de offboard) e tem login no OS. O vínculo com o
 * login é o profile_id; sem ele, o e-mail do cadastro e, por fim, o nome igual.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type MembroDaEquipe = { id: string; nome: string; avatar: string | null };

export async function equipeDaInbox(sb: SupabaseClient): Promise<MembroDaEquipe[]> {
  const { data: pessoas, error } = await sb
    .from("payroll_internal_costs")
    .select("payee_name, lifecycle_stage, offboard_at, profile_id, payroll_profile");
  if (error || !pessoas?.length) return [];
  const agora = Date.now();
  const ativas = pessoas.filter(
    (p) => p.lifecycle_stage !== "offboard" || (p.offboard_at && new Date(p.offboard_at as string).getTime() > agora),
  );
  if (!ativas.length) return [];
  const emailDe = (p: Record<string, unknown>) => {
    const e = (p.payroll_profile as Record<string, unknown> | null)?.email;
    return typeof e === "string" ? e.trim().toLowerCase() : null;
  };
  const { data: perfis } = await sb.from("profiles").select("id, full_name, email, avatar_url, is_active").neq("is_active", false);
  const lista = (perfis ?? []) as { id: string; full_name: string | null; email: string | null; avatar_url: string | null }[];
  const porId = new Map(lista.map((p) => [p.id, p]));
  const porEmail = new Map(lista.filter((p) => p.email).map((p) => [p.email!.toLowerCase(), p]));
  const porNome = new Map<string, (typeof lista)[number] | null>();
  for (const p of lista) {
    const k = (p.full_name ?? "").trim().toLowerCase();
    if (!k) continue;
    // Nome repetido não prova quem é: fica de fora.
    porNome.set(k, porNome.has(k) ? null : p);
  }

  const vistos = new Set<string>();
  const equipe: MembroDaEquipe[] = [];
  for (const p of ativas) {
    const nome = String(p.payee_name ?? "").trim();
    const perfil =
      (p.profile_id ? porId.get(p.profile_id as string) : undefined) ??
      (emailDe(p) ? porEmail.get(emailDe(p)!) : undefined) ??
      porNome.get(nome.toLowerCase()) ??
      null;
    if (!perfil || vistos.has(perfil.id)) continue;
    vistos.add(perfil.id);
    equipe.push({ id: perfil.id, nome: nome || perfil.full_name || "Team member", avatar: perfil.avatar_url });
  }
  return equipe.sort((a, b) => a.nome.localeCompare(b.nome));
}
