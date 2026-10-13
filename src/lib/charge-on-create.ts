/**
 * Quem pode receber a cobrança automática na criação do job (dono, 13/10/2026).
 *
 * Cliente direto recebe. Cliente de plataforma não: a conta dela está com o e-mail
 * de fatura desligado (`email_include_invoice_on_final = false`), que é a mesma
 * chave que já impede o e-mail de conclusão. Uma chave só para "esta conta nunca
 * recebe fatura nossa".
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ChargeOnCreateDecision = { ok: true } | { ok: false; reason: string };

export function decideChargeOnCreate(account: { company_name?: string | null; email_include_invoice_on_final?: boolean | null } | null): ChargeOnCreateDecision {
  if (!account) return { ok: true };
  if (account.email_include_invoice_on_final === false) {
    return { ok: false, reason: `${account.company_name?.trim() || "This account"} does not receive invoices from us: no payment request was sent.` };
  }
  return { ok: true };
}

export async function accountAllowsChargeOnCreate(admin: SupabaseClient, clientId: string | null): Promise<ChargeOnCreateDecision> {
  if (!clientId) return { ok: false, reason: "This job has no client: no payment request was sent." };
  const { data: client } = await admin.from("clients").select("source_account_id").eq("id", clientId).maybeSingle();
  const accountId = (client as { source_account_id?: string | null } | null)?.source_account_id ?? null;
  if (!accountId) return { ok: true };
  const { data: account } = await admin.from("accounts").select("company_name, email_include_invoice_on_final").eq("id", accountId).maybeSingle();
  return decideChargeOnCreate(account as { company_name?: string | null; email_include_invoice_on_final?: boolean | null } | null);
}
