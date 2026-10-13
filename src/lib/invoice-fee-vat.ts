/**
 * Fatura com VAT só sobre a taxa da Fixfy (dono, 13/10/2026).
 *
 * Para as contas que pedem assim, o documento mostra o serviço do parceiro
 * repassado sem VAT e a taxa da Fixfy aberta em líquido + VAT. O TOTAL NÃO MUDA:
 * o VAT sai de dentro da taxa, como já era feito à mão no Xero (INV-3396).
 * Quem liga é a conta (`accounts.invoice_fee_vat`), nunca o sistema inteiro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { COMMISSION_VAT_RATE_PCT, FIXFY_LEGAL_ENTITY } from "@/lib/agent-model/commission";

export type FeeVatBreakdown = { net: number; vat: number; ratePct: number; vatNumber: string };
export type InvoiceBillTo = { legalName: string; addressLines: string[]; companyNumber: string | null };

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** A taxa (que já inclui o VAT) aberta em líquido e VAT. Os dois somam a taxa, sempre. */
export function splitFeeVat(feeGross: number, ratePct: number = COMMISSION_VAT_RATE_PCT): { net: number; vat: number } {
  const gross = Math.max(0, round2(feeGross));
  const net = round2(gross / (1 + ratePct / 100));
  return { net, vat: round2(gross - net) };
}

/** "10 Shepherdess Walk, London N1 7LB" vira linhas do bloco de endereço. */
export function addressLines(address: string | null | undefined): string[] {
  return String(address ?? "")
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

type AccountRow = { company_name?: string | null; address?: string | null; crn?: string | null; billing_legal_name?: string | null; invoice_fee_vat?: boolean | null };

/**
 * O que a conta pede na fatura. Devolve null quando a conta não usa o formato,
 * ou quando as colunas ainda não existem no banco (migration 323 não aplicada):
 * nesse caso a fatura sai como sempre saiu.
 */
export async function loadAccountInvoiceFormat(
  admin: SupabaseClient,
  accountId: string | null | undefined,
  feeGross: number,
): Promise<{ feeVat: FeeVatBreakdown; billTo: InvoiceBillTo } | null> {
  if (!accountId) return null;
  const { data, error } = await admin
    .from("accounts")
    .select("company_name, address, crn, billing_legal_name, invoice_fee_vat")
    .eq("id", accountId)
    .maybeSingle();
  if (error || !data) return null;
  const a = data as AccountRow;
  if (!a.invoice_fee_vat) return null;
  const legalName = (a.billing_legal_name ?? "").trim() || (a.company_name ?? "").trim();
  if (!legalName) return null;
  return {
    feeVat: { ...splitFeeVat(feeGross), ratePct: COMMISSION_VAT_RATE_PCT, vatNumber: FIXFY_LEGAL_ENTITY.vatNumber },
    billTo: { legalName, addressLines: addressLines(a.address), companyNumber: (a.crn ?? "").trim() || null },
  };
}
