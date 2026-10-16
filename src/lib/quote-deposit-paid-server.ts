import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nomeDoParceiroNoAceite } from "@/lib/quote-accept-job-fields";

/**
 * O que roda no servidor depois do aceite e da entrada paga (16/10/2026).
 *
 * Separado de `quote-accept-job-fields` porque aqui se manda e-mail (recibo, Job
 * confirmed, aviso ao parceiro) e isso não pode ir para o navegador: o "mark as paid"
 * da tela usa `sync-job-after-invoice-paid`, que no navegador chama a rota
 * `/api/quotes/deposit-paid` em vez de importar este arquivo.
 */

/**
 * Depois do aceite (15/10/2026): o job da cotação ganha a self-bill da quinzena e, quando
 * pedido, o parceiro recebe o aviso de job novo ("assigned", e-mail; side conversation se
 * o job tiver ticket). Antes a self-bill era tentada com o client de navegador num `void`
 * solto e não nascia; o parceiro não era avisado.
 *
 * Com entrada, o aviso espera a entrada paga (Stripe ou marcada à mão): o parceiro não vai
 * a um job que o cliente ainda não confirmou.
 */
export async function prepararJobDoAceite(
  supabase: SupabaseClient,
  jobId: string,
  opcoes: { avisarParceiro: boolean },
): Promise<{ selfBillId: string | null; aviso: "enviado" | "pulado" | "falhou" }> {
  const { data: row } = await supabase.from("jobs").select("*").eq("id", jobId).maybeSingle();
  const job = row as { id: string; partner_id?: string | null; self_bill_id?: string | null } | null;
  if (!job?.partner_id) return { selfBillId: null, aviso: "pulado" };

  let selfBillId: string | null = job.self_bill_id ?? null;
  if (!selfBillId) {
    try {
      const { ensureWeeklySelfBillForJob } = await import("@/services/self-bills");
      selfBillId = await ensureWeeklySelfBillForJob(row as never, { client: supabase });
    } catch (e) {
      console.error("[aceite] self-bill do job", jobId, e);
    }
  }

  if (!opcoes.avisarParceiro) return { selfBillId, aviso: "pulado" };
  try {
    const { notifyPartnerJobZendesk } = await import("@/lib/notify-partner-job-zendesk-server");
    const r = await notifyPartnerJobZendesk(supabase, jobId, { kind: "assigned", actorUserId: null });
    return { selfBillId, aviso: r.status === 200 ? "enviado" : "falhou" };
  } catch (e) {
    console.error("[aceite] aviso ao parceiro", jobId, e);
    return { selfBillId, aviso: "falhou" };
  }
}

/**
 * Entrada da cotação paga (Stripe ou à mão). Rotina do dono (16/10/2026):
 *   1. cotação vai para converted_to_job;
 *   2. o cliente recebe o recibo da entrada (Payment received);
 *   3. cotação com parceiro (veio de lance): o parceiro entra no job, que vira Scheduled,
 *      ganha a self-bill, o parceiro é avisado e o cliente recebe o Job confirmed;
 *      sem parceiro: o job fica em Unassigned para a equipe.
 * Só age com a cotação em awaiting_payment, então rodar duas vezes não repete nada.
 */
export async function aposEntradaDaCotacaoPaga(
  supabase: SupabaseClient,
  jobReference: string,
  origem: string,
): Promise<boolean> {
  const { data: jobRow } = await supabase.from("jobs").select("id, quote_id").eq("reference", jobReference).maybeSingle();
  const j = jobRow as { id: string; quote_id?: string | null } | null;
  if (!j?.quote_id) return false;
  const { data: q } = await supabase
    .from("quotes")
    .select("id, reference, status, partner_id, partner_name")
    .eq("id", j.quote_id)
    .maybeSingle();
  const quote = q as {
    id: string;
    reference?: string | null;
    status?: string | null;
    partner_id?: string | null;
    partner_name?: string | null;
  } | null;
  if (!quote || quote.status !== "awaiting_payment") return false;
  const { data: mudou, error } = await supabase
    .from("quotes")
    .update({ status: "converted_to_job", updated_at: new Date().toISOString() })
    .eq("id", quote.id)
    .eq("status", "awaiting_payment")
    .select("id");
  if (error || !mudou?.length) return false;
  await supabase.from("audit_logs").insert({
    entity_type: "quote",
    entity_id: quote.id,
    entity_ref: quote.reference ?? null,
    action: "status_changed",
    field_name: "status",
    old_value: "awaiting_payment",
    new_value: "converted_to_job",
    metadata: { deposit_paid: true, source: origem },
  });

  await enviarReciboDaEntrada(supabase, jobReference);

  // O parceiro entra agora SÓ se o preço veio de um lance que ele mesmo enviou
  // (dono, 16/10/2026). Preço nosso (tabela) ou dado pela equipe: o job fica em
  // Unassigned e a equipe aloca, mesmo que a cotação tenha um parceiro anotado.
  // O job só sai de Unassigned se ainda estiver lá sem ninguém (job antigo, aceito antes
  // desta regra, já nasceu Scheduled e fica como está).
  const parceiroId = (await parceiroQueDeuOLance(supabase, quote.id, quote.partner_id)) ?? "";
  if (parceiroId) {
    const nome = await nomeDoParceiroNoAceite(supabase, quote);
    const { error: erroParceiro } = await supabase
      .from("jobs")
      .update({ partner_id: parceiroId, partner_name: nome, status: "scheduled" })
      .eq("id", j.id)
      .eq("status", "unassigned")
      .is("partner_id", null);
    if (erroParceiro) console.error("[entrada paga] parceiro no job", j.id, erroParceiro.message);
  }

  await prepararJobDoAceite(supabase, j.id, { avisarParceiro: true });

  // Ticket sai de Approval agora (enquanto esperava a entrada o sync segurava): Scheduled
  // com o parceiro do lance, Unassigned sem ele.
  try {
    const { syncJobZendeskStatus } = await import("@/lib/zendesk-status-sync");
    await syncJobZendeskStatus(j.id, supabase);
  } catch (e) {
    console.error("[entrada paga] status do ticket", j.id, e);
  }

  // Job confirmed ao cliente: só sai se o job tem parceiro e data (o dispatch confere).
  try {
    const { dispatchJobCreatedZendesk } = await import("@/lib/zendesk-lifecycle");
    await dispatchJobCreatedZendesk({ jobId: j.id, client: supabase });
  } catch (e) {
    console.error("[entrada paga] job confirmed", j.id, e);
  }
  return true;
}

/** Lances que contam: enviados pelo parceiro (submitted) ou aprovados pela equipe em cima deles. */
export const STATUS_DE_LANCE_VALIDO = ["submitted", "approved"];

/**
 * Parceiro da cotação, só se ele mandou lance nela. Null = preço nosso ou da equipe:
 * ninguém é alocado automaticamente.
 */
export async function parceiroQueDeuOLance(
  supabase: SupabaseClient,
  quoteId: string,
  partnerId: string | null | undefined,
): Promise<string | null> {
  const id = String(partnerId ?? "").trim();
  if (!id) return null;
  const { data } = await supabase
    .from("quote_bids")
    .select("id")
    .eq("quote_id", quoteId)
    .eq("partner_id", id)
    .in("status", STATUS_DE_LANCE_VALIDO)
    .limit(1);
  return (data as unknown[] | null)?.length ? id : null;
}

/** Recibo da entrada ao cliente: o e-mail da fatura de entrada, que paga sai como "Payment received". */
async function enviarReciboDaEntrada(supabase: SupabaseClient, jobReference: string): Promise<void> {
  const { data: inv } = await supabase
    .from("invoices")
    .select("id")
    .eq("job_reference", jobReference)
    .eq("invoice_kind", "deposit")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const invoiceId = (inv as { id?: string } | null)?.id;
  if (!invoiceId) return;
  try {
    const { sendInvoiceEmail } = await import("@/lib/invoice-send-email");
    const r = await sendInvoiceEmail(supabase, invoiceId, { userId: null, userName: "Fixfy (deposit paid)" });
    if ("error" in r) console.error("[entrada paga] recibo", invoiceId, r.error);
  } catch (e) {
    console.error("[entrada paga] recibo", invoiceId, e);
  }
}
