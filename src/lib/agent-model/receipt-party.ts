/**
 * Quem emite o recibo de um job de Schedule A: o profissional (parceiro) do job.
 *
 * Devolve `null` quando o job é Schedule B ou o modelo está desligado. Aí quem
 * chama segue com o documento de sempre, sem mudar uma vírgula.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveJobWorkSchedule } from "./schedule";
import type { AgentReceiptParty } from "./receipt-view";
import { loadJobPromotionAmount } from "./promotion";

export type JobForReceiptParty = {
  id?: string | null;
  client_id?: string | null;
  created_at?: string | null;
  partner_id?: string | null;
};

type PartnerRow = {
  company_name?: string | null;
  contact_name?: string | null;
  partner_address?: string | null;
  vat_number?: string | null;
  vat_registered?: boolean | null;
};

/** Nome, endereço e VAT do parceiro como o cliente deve ler. */
export function receiptPartyFromPartner(p: PartnerRow | null | undefined): AgentReceiptParty {
  if (!p) return { professionalName: null, businessAddress: null, vatNumber: null };
  const name = p.company_name?.trim() || p.contact_name?.trim() || null;
  /**
   * TODO(agent-model): o endereço que o recibo pede é o comercial (ou o do
   * comprovante de endereço do cadastro, decisão do dono em 06/10/2026). O OS
   * só tem `partners.partner_address` (casa ou sede). Sem ele, o recibo sai só
   * com o nome, e isso precisa ser corrigido no cadastro do parceiro.
   */
  const address = p.partner_address?.trim() || null;
  const vatRaw = p.vat_number?.trim() || "";
  const vatNumber = p.vat_registered === false ? null : vatRaw || null;
  return { professionalName: name, businessAddress: address, vatNumber };
}

export async function loadAgentReceiptParty(
  supabase: SupabaseClient,
  job: JobForReceiptParty | null | undefined,
): Promise<AgentReceiptParty | null> {
  if (!job?.id) return null;
  const schedule = await resolveJobWorkSchedule(supabase, {
    id: String(job.id),
    client_id: job.client_id ?? null,
    created_at: job.created_at ?? null,
  });
  if (schedule !== "A") return null;

  // Promoção da Fixfy no job (mig 313): linha própria no recibo. Sem a coluna = 0.
  const promotionAmount = await loadJobPromotionAmount(supabase, String(job.id));

  const partnerId = String(job.partner_id ?? "").trim();
  if (!partnerId) return { ...receiptPartyFromPartner(null), promotionAmount };
  const { data, error } = await supabase
    .from("partners")
    .select("company_name, contact_name, partner_address, vat_number, vat_registered")
    .eq("id", partnerId)
    .maybeSingle();
  if (error) {
    console.error("[agent-model] partner lookup for receipt failed:", error.message);
    return { ...receiptPartyFromPartner(null), promotionAmount };
  }
  const party: AgentReceiptParty = { ...receiptPartyFromPartner((data ?? null) as PartnerRow | null), promotionAmount };
  if (party.professionalName && !party.businessAddress) {
    console.warn(`[agent-model] partner ${partnerId} has no business address: receipt shows the name only`);
  }
  return party;
}
