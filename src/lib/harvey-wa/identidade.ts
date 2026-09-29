/**
 * Quem está escrevendo no WhatsApp: parceiro, cliente que já existe no OS, ou
 * gente nova. O telefone vem em formatos soltos no banco ("07508 801803",
 * "+44 7508 801803"), então a comparação é pelos 10 últimos dígitos.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type Parceiro = {
  id: string;
  status: string;
  company_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  trade: string | null;
  zendesk_organization_id: string | null;
};
export type Cliente = { id: string; full_name: string | null; email: string | null; phone: string | null; address: string | null; postcode: string | null };
export type Identidade = { tipo: "parceiro"; parceiro: Parceiro } | { tipo: "cliente"; cliente: Cliente } | { tipo: "novo" };

export function chaveDoTelefone(tel: string | null | undefined): string {
  const d = (tel ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

/** O banco não compara telefone normalizado: filtra pelos 4 últimos dígitos e confere aqui. */
async function candidatos<T extends { phone: string | null }>(sb: SupabaseClient, tabela: string, campos: string, chave: string): Promise<T[]> {
  const fim = chave.slice(-4);
  const { data } = await sb.from(tabela).select(campos).ilike("phone", `%${fim.slice(0, 2)}%${fim.slice(2)}`).limit(200);
  return ((data ?? []) as unknown as T[]).filter((r) => chaveDoTelefone(r.phone) === chave);
}

export async function quemE(sb: SupabaseClient, telefone: string | null): Promise<Identidade> {
  const chave = chaveDoTelefone(telefone);
  if (!chave) return { tipo: "novo" };
  // A conta interna (e-mail @getfixfy.com, o parceiro "Fixfy") não conta: é o
  // telefone da equipe, que testa como cliente (mesma regra do Harvey do e-mail).
  const parceiros = (await candidatos<Parceiro>(sb, "partners", "id, status, company_name, contact_name, email, phone, trade, zendesk_organization_id", chave)).filter(
    (p) => !/@getfixfy\.com$/i.test(p.email ?? ""),
  );
  // Mais de um cadastro no mesmo número: vale o que trabalha (ativo), depois o mais recente no funil.
  const ordem = ["active", "needs_attention", "onboarding", "on_break", "inactive"];
  const parceiro = parceiros.sort((a, b) => ordem.indexOf(a.status) - ordem.indexOf(b.status))[0];
  if (parceiro) return { tipo: "parceiro", parceiro };
  const clientes = await candidatos<Cliente>(sb, "clients", "id, full_name, email, phone, address, postcode", chave);
  if (clientes[0]) return { tipo: "cliente", cliente: clientes[0] };
  return { tipo: "novo" };
}
