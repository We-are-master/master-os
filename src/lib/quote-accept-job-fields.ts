import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Campos que o job ganha no aceite da cotação (15/10/2026).
 *
 * Antes o job nascia "scheduled" sem data e com o nome do parceiro vazio quando a
 * cotação guardava só o `partner_id` (achado no teste lead → job, JOB-9733).
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Hoje em Londres, YYYY-MM-DD. */
function hojeLondres(agora: Date): string {
  return agora.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

/**
 * Data do job: a primeira data proposta pelo parceiro no lance que ainda não passou,
 * depois a segunda. Só o dia; a janela de chegada o escritório combina depois.
 */
export function dataDoJobNoAceite(
  quote: { start_date_option_1?: string | null; start_date_option_2?: string | null },
  agora: Date = new Date(),
): string | null {
  const hoje = hojeLondres(agora);
  for (const bruto of [quote.start_date_option_1, quote.start_date_option_2]) {
    const d = String(bruto ?? "").trim().slice(0, 10);
    if (YMD.test(d) && d >= hoje) return d;
  }
  return null;
}

/** Nome do parceiro: o da cotação, senão o do cadastro (empresa, depois contato). */
export async function nomeDoParceiroNoAceite(
  supabase: SupabaseClient,
  quote: { partner_id?: string | null; partner_name?: string | null },
): Promise<string | null> {
  const doQuote = String(quote.partner_name ?? "").trim();
  if (doQuote) return doQuote;
  const id = String(quote.partner_id ?? "").trim();
  if (!id) return null;
  const { data } = await supabase.from("partners").select("company_name, contact_name").eq("id", id).maybeSingle();
  const p = data as { company_name?: string | null; contact_name?: string | null } | null;
  return p?.company_name?.trim() || p?.contact_name?.trim() || null;
}

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
 * Entrada da cotação paga (Stripe ou à mão): cotação vai para converted_to_job e o
 * parceiro recebe o aviso de job novo. Só age com a cotação em awaiting_payment, então
 * rodar duas vezes não manda dois avisos.
 */
export async function aposEntradaDaCotacaoPaga(
  supabase: SupabaseClient,
  jobReference: string,
  origem: string,
): Promise<boolean> {
  const { data: jobRow } = await supabase.from("jobs").select("id, quote_id").eq("reference", jobReference).maybeSingle();
  const j = jobRow as { id: string; quote_id?: string | null } | null;
  if (!j?.quote_id) return false;
  const { data: q } = await supabase.from("quotes").select("id, reference, status").eq("id", j.quote_id).maybeSingle();
  const quote = q as { id: string; reference?: string | null; status?: string | null } | null;
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
  await prepararJobDoAceite(supabase, j.id, { avisarParceiro: true });
  return true;
}
