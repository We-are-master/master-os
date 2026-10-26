import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Parceiro que aceita quote ou só job fechado (dono, 26/10/2026).
 *
 * Tem parceiro que não quer orçar: só quer receber o job já vendido. A chave é
 * `job_preferences.receiveLeads`, a mesma que o parceiro responde no onboarding
 * do portal ("Do you want to quote for jobs too?"). Sem valor gravado, aceita (é como todo
 * parceiro funcionava antes). Desligada, ele não recebe convite para dar lance
 * em nenhum caminho, mas continua recebendo job booked, manual ou auto-assign.
 */
export function aceitaQuotes(prefs: { receiveLeads?: unknown } | null | undefined): boolean {
  return prefs?.receiveLeads !== false;
}

/** Tira da lista quem só recebe job fechado. Mantém a ordem. */
export async function soQuemAceitaQuotes(sb: SupabaseClient, partnerIds: string[]): Promise<string[]> {
  const ids = [...new Set(partnerIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const { data, error } = await sb.from("partners").select("id, job_preferences").in("id", ids);
  if (error) throw new Error(`partners: ${error.message}`);
  const fora = new Set(
    ((data ?? []) as Array<{ id: string; job_preferences?: { receiveLeads?: unknown } | null }>)
      .filter((p) => !aceitaQuotes(p.job_preferences))
      .map((p) => p.id),
  );
  return partnerIds.filter((id) => id && !fora.has(id));
}
