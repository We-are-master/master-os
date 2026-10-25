/**
 * Macro "Quote refused" no Zendesk (dono, 25/10/2026): a conta ou o cliente
 * avisa no ticket que não vai seguir ("The customer has not accepted this
 * quote", #51515), e quem lê aplica a macro. A macro resolve o ticket e põe a
 * tag `quote_refused`; o gatilho chama a rota `/api/webhooks/desk/quote-refused`,
 * que chega aqui.
 *
 * Aqui: a quote aberta do ticket vira `rejected`, como a recusa pelo link
 * (`/api/quotes/respond`), com o mesmo registro no histórico. Quote já aceita
 * não muda. Não manda nada ao cliente: foi ele quem recusou. No ticket fica o
 * Closing Summary e uma nota interna com o que mudou no OS.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isZendeskConfigured, updateTicket } from "@/lib/zendesk";

const ESTADOS_ACEITOS = new Set(["awaiting_payment", "converted_to_job"]);
const CAMPO_CLOSING_SUMMARY = 6417950403231;

export type ResultadoDaRecusa =
  | { ok: true; recusadas: string[]; jaRecusadas: string[]; aceitas: string[] }
  | { ok: false; status: number; error: string };

export async function recusarQuoteDoTicket(
  sb: SupabaseClient,
  args: { ticketId: string; motivo?: string | null },
): Promise<ResultadoDaRecusa> {
  const ticketId = String(args.ticketId ?? "").trim();
  if (!/^\d+$/.test(ticketId)) return { ok: false, status: 400, error: "ticket_id must be a Zendesk ticket number." };
  const motivo = args.motivo?.trim() || null;

  const { data, error } = await sb
    .from("quotes")
    .select("id, reference, status")
    .eq("external_source", "zendesk")
    .eq("external_ref", ticketId)
    .is("deleted_at", null);
  if (error) return { ok: false, status: 500, error: error.message };
  const quotes = (data ?? []) as Array<{ id: string; reference: string; status: string }>;
  if (!quotes.length) return { ok: false, status: 404, error: `No quote linked to ticket #${ticketId}.` };

  const recusadas: string[] = [];
  const jaRecusadas: string[] = [];
  const aceitas: string[] = [];
  for (const q of quotes) {
    if (q.status === "rejected") {
      jaRecusadas.push(q.reference);
      continue;
    }
    if (ESTADOS_ACEITOS.has(q.status)) {
      aceitas.push(q.reference);
      continue;
    }
    const { data: trocou, error: erroTroca } = await sb
      .from("quotes")
      .update({ status: "rejected", rejection_reason: motivo ?? "Refused by the customer (Zendesk)", updated_at: new Date().toISOString() })
      .eq("id", q.id)
      .eq("status", q.status)
      .select("id");
    if (erroTroca) return { ok: false, status: 500, error: erroTroca.message };
    if (!trocou?.length) continue; // mudou no meio do caminho: não sobrescreve
    recusadas.push(q.reference);
    await sb.from("audit_logs").insert({
      entity_type: "quote",
      entity_id: q.id,
      entity_ref: q.reference,
      action: "status_changed",
      field_name: "status",
      old_value: q.status,
      new_value: "rejected",
      metadata: { via: "zendesk_macro_quote_refused", ticket_id: ticketId, ...(motivo ? { rejection_reason: motivo } : {}) },
    });
  }

  if (isZendeskConfigured() && (recusadas.length || aceitas.length)) {
    const resumo = recusadas.length
      ? `Quote ${recusadas.join(", ")} refused by the customer${motivo ? `: ${motivo}` : "."}`
      : null;
    const linhas = [
      recusadas.length ? `Quote ${recusadas.join(", ")} marked as rejected in the OS.` : null,
      aceitas.length ? `Not changed: ${aceitas.join(", ")} was already accepted. Check with the customer before cancelling the job.` : null,
    ].filter(Boolean);
    await updateTicket({
      ticketId,
      htmlBody: `<p>${linhas.join("<br>")}</p>`,
      publicComment: false,
      ...(resumo ? { customFields: [{ id: CAMPO_CLOSING_SUMMARY, value: resumo }] } : {}),
    }).catch((e) => console.error("[quote-refused] ticket note failed:", e instanceof Error ? e.message : e));
  }

  return { ok: true, recusadas, jaRecusadas, aceitas };
}
