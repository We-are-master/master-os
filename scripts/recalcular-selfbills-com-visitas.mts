/**
 * Self-bills abertos com visita, pela regra de 22/10/2026: visita só paga o
 * parceiro depois do Done. Documento que somava visita ainda marcada cai.
 *
 *   npx tsx scripts/recalcular-selfbills-com-visitas.mts            # ensaio: lista, não grava
 *   npx tsx scripts/recalcular-selfbills-com-visitas.mts --aplicar  # recalcula os que mudam
 *
 * Idempotente: recalcular de novo dá o mesmo número. Pago, interno ou cancelado
 * não é tocado (o recálculo do serviço já pula esses).
 */
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal();
const APLICAR = process.argv.includes("--aplicar");

const [{ createServiceClient }, { loadSelfBillPayoutLines, refreshSelfBillPayoutState }] = await Promise.all([
  import("../src/lib/supabase/service"),
  import("../src/services/self-bills"),
]);
const supabase = createServiceClient();

const { data: visitas, error } = await supabase
  .from("job_visits")
  .select("self_bill_id")
  .not("self_bill_id", "is", null)
  .is("deleted_at", null);
if (error) throw new Error(error.message);
const ids = [...new Set((visitas ?? []).map((v) => (v as { self_bill_id: string }).self_bill_id))];

const { data: docs, error: docErr } = ids.length
  ? await supabase
      .from("self_bills")
      .select("id, reference, partner_name, status, bill_origin, net_payout, payout_breakdown")
      .in("id", ids)
      .not("status", "in", "(paid,cancelled,rejected)")
  : { data: [], error: null };
if (docErr) throw new Error(docErr.message);

const { sumSelfBillAdjustments, readSelfBillAdjustments } = await import("../src/lib/self-bill-adjustments");
let mudam = 0;
for (const d of (docs ?? []) as Array<{ id: string; reference: string; partner_name: string; status: string; bill_origin?: string | null; net_payout: number; payout_breakdown: unknown }>) {
  if (d.bill_origin === "internal") continue;
  const linhas = await loadSelfBillPayoutLines(d.id, supabase);
  const bruto = linhas.reduce((s, l) => s + l.labour + l.materials, 0);
  const ajustes = sumSelfBillAdjustments(readSelfBillAdjustments(d.payout_breakdown as never));
  const novo = Math.round(Math.max(0, bruto - ajustes) * 100) / 100;
  const atual = Math.round(Number(d.net_payout ?? 0) * 100) / 100;
  if (Math.abs(novo - atual) < 0.01) continue;
  mudam++;
  if (!APLICAR) {
    console.log(`· ${d.reference.padEnd(9)} ${d.partner_name.padEnd(22)} ${d.status.padEnd(13)} £${atual.toFixed(2)} → £${novo.toFixed(2)}`);
    continue;
  }
  await refreshSelfBillPayoutState(d.id, supabase);
  const { data: depois } = await supabase.from("self_bills").select("net_payout").eq("id", d.id).maybeSingle();
  console.log(`✓ ${d.reference.padEnd(9)} ${d.partner_name.padEnd(22)} £${atual.toFixed(2)} → £${Number((depois as { net_payout?: number } | null)?.net_payout ?? 0).toFixed(2)}`);
}
console.log(`\n${mudam} self-bill(s) ${APLICAR ? "recalculados" : "mudam"} · ${(docs ?? []).length} aberto(s) com visita${APLICAR ? "" : " · ensaio, nada gravado (use --aplicar)"}`);
