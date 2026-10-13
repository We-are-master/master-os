/**
 * Quem recebe cópia da fatura de uma conta (dono, 13/10/2026: o financeiro da
 * LF Europe tem que estar em toda fatura). Vem de `accounts.invoice_cc_emails`
 * (migration 324). Sem a coluna, ou sem conta, ninguém a mais é copiado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** Limpa a lista: só e-mail válido, sem repetir, e sem quem já é o destinatário principal. */
export function limparCopias(lista: unknown, jaRecebem: Array<string | null | undefined> = []): string[] {
  const fora = new Set(jaRecebem.map((e) => String(e ?? "").trim().toLowerCase()).filter(Boolean));
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const item of Array.isArray(lista) ? lista : []) {
    const e = String(item ?? "").trim();
    const chave = e.toLowerCase();
    if (!EMAIL.test(e) || fora.has(chave) || vistos.has(chave)) continue;
    vistos.add(chave);
    out.push(e);
  }
  return out;
}

export async function copiasDaFaturaDaConta(admin: SupabaseClient, accountId: string | null | undefined, jaRecebem: Array<string | null | undefined> = []): Promise<string[]> {
  if (!accountId) return [];
  const { data, error } = await admin.from("accounts").select("invoice_cc_emails").eq("id", accountId).maybeSingle();
  if (error || !data) return [];
  return limparCopias((data as { invoice_cc_emails?: unknown }).invoice_cc_emails, jaRecebem);
}
