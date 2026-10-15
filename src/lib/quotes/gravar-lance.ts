/**
 * Grava o lance de um parceiro numa quote: uma linha por (quote, parceiro),
 * atualiza se já existe. É o MESMO caminho do link do portal (submit-bid) e do
 * leitor de lances por e-mail (lances-por-email.ts): o lance entra igual, venha
 * de onde vier, e a varredura de lances trata os dois do mesmo jeito.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { prepararPropostaDoLance } from "@/lib/quotes/lance-para-proposta";

export type LanceParaGravar = {
  quoteId: string;
  quoteReference: string;
  partnerId: string;
  partnerName: string | null;
  bidAmount: number;
  jobType: "fixed" | "hourly";
  /** Já no formato do portal (BID_JSON + texto livre). */
  notes: string;
  /** Para o audit log: "public_partner_link" ou "side_conversation_email". */
  origem: string;
};

export async function gravarLanceDoParceiro(
  supabase: SupabaseClient,
  l: LanceParaGravar,
): Promise<{ ok: true; bidId: string } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("quote_bids")
    .select("id")
    .eq("quote_id", l.quoteId)
    .eq("partner_id", l.partnerId)
    .maybeSingle();

  let bidId: string;
  if (existing?.id) {
    const { error } = await supabase
      .from("quote_bids")
      .update({ bid_amount: l.bidAmount, job_type: l.jobType, notes: l.notes, status: "submitted", updated_at: now })
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    bidId = existing.id as string;
  } else {
    const { data: inserted, error } = await supabase
      .from("quote_bids")
      .insert({
        quote_id: l.quoteId,
        partner_id: l.partnerId,
        partner_name: l.partnerName,
        bid_amount: l.bidAmount,
        job_type: l.jobType,
        notes: l.notes,
        status: "submitted",
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single();
    if (error || !inserted) return { ok: false, error: error?.message ?? "insert failed" };
    bidId = inserted.id as string;
  }

  // Com await: `void` depois da resposta morre na Vercel.
  const { error: auditErr } = await supabase.from("audit_logs").insert({
    entity_type: "quote",
    entity_id: l.quoteId,
    entity_ref: l.quoteReference,
    action: "bid_submitted",
    field_name: "quote_bids",
    new_value: String(l.bidAmount),
    metadata: { source: l.origem, partner_id: l.partnerId, job_type: l.jobType, bid_id: bidId },
  });
  if (auditErr) console.error("audit_logs (bid)", auditErr);

  // Fase 4: o lance vira proposta com margem (e sai sozinho quando pode). Nunca derruba o lance.
  await prepararPropostaDoLance(supabase, l.quoteId, bidId).catch((e) => console.error("[lance] proposta do lance:", e));
  return { ok: true, bidId };
}
