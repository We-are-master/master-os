/**
 * Uma mensagem sai uma vez, um evento é processado uma vez (plano do dono,
 * 22/10/2026, item 3; tabelas da migration 345).
 *
 *   const r = await reservarEnvio(sb, { chave: `lembrete-24h:${job.id}:${data}`, ... });
 *   if (!r.reservado) return;              // outra rodada já mandou ou está mandando
 *   try { const id = await mandar(); await confirmarEnvio(sb, r.chave, id); }
 *   catch (e) { await falhouEnvio(sb, r.chave, e); throw e; }
 *
 * A reserva vem ANTES do envio. Foi o que faltou na régua de leads de 15 a
 * 20/10/2026: marcar depois de mandar, com a marca falhando, repetiu o WhatsApp
 * de 10 em 10 minutos.
 *
 * Falha libera a chave (status failed): a próxima rodada pode tentar de novo.
 * Reserva presa (a rodada morreu no meio) só é retomada depois de `reservaVenceEm`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type CanalDoEnvio = "email" | "whatsapp" | "zendesk_note" | "sms";

export type PedidoDeEnvio = {
  chave: string;
  finalidade: string;
  canal: CanalDoEnvio;
  jobId?: string | null;
  quoteId?: string | null;
  ticketId?: number | null;
  destinatario?: string | null;
  template?: string | null;
  motivo?: string | null;
};

/** Reserva sem confirmação há mais que isto é tratada como rodada morta. */
export const RESERVA_VENCE_EM_MIN = 30;

export function chaveDeEnvio(...partes: Array<string | number | null | undefined>): string {
  return partes.map((p) => String(p ?? "").trim()).join(":");
}

export async function reservarEnvio(sb: SupabaseClient, p: PedidoDeEnvio, agora = new Date()): Promise<{ reservado: boolean; chave: string; motivo?: string }> {
  const linha = {
    dedupe_key: p.chave,
    purpose: p.finalidade,
    channel: p.canal,
    job_id: p.jobId ?? null,
    quote_id: p.quoteId ?? null,
    zendesk_ticket_id: p.ticketId ?? null,
    recipient: p.destinatario ?? null,
    template: p.template ?? null,
    reason: p.motivo ?? null,
    status: "reserved",
    reserved_at: agora.toISOString(),
  };
  const { error } = await sb.from("outbound_messages").insert(linha);
  if (!error) return { reservado: true, chave: p.chave };
  if (error.code !== "23505") return { reservado: false, chave: p.chave, motivo: `reserva falhou: ${error.message}` };

  // Já existe: só retoma se a anterior falhou ou ficou presa.
  const { data } = await sb.from("outbound_messages").select("status, reserved_at").eq("dedupe_key", p.chave).maybeSingle<{ status: string; reserved_at: string }>();
  if (!data) return { reservado: false, chave: p.chave, motivo: "reserva sumiu" };
  if (data.status === "sent") return { reservado: false, chave: p.chave, motivo: "already sent" };
  const presa = data.status === "reserved" && agora.getTime() - Date.parse(data.reserved_at) > RESERVA_VENCE_EM_MIN * 60_000;
  if (data.status !== "failed" && !presa) return { reservado: false, chave: p.chave, motivo: "another run is sending" };
  // Retoma com troca atômica: só uma rodada vê a linha no estado em que leu.
  const { data: tomou } = await sb
    .from("outbound_messages")
    .update({ status: "reserved", reserved_at: agora.toISOString(), error: null })
    .eq("dedupe_key", p.chave)
    .eq("status", data.status)
    .eq("reserved_at", data.reserved_at)
    .select("dedupe_key");
  return tomou?.length ? { reservado: true, chave: p.chave } : { reservado: false, chave: p.chave, motivo: "another run took it" };
}

export async function confirmarEnvio(sb: SupabaseClient, chave: string, providerId?: string | null): Promise<void> {
  await sb.from("outbound_messages").update({ status: "sent", sent_at: new Date().toISOString(), provider_id: providerId ?? null }).eq("dedupe_key", chave);
}

export async function falhouEnvio(sb: SupabaseClient, chave: string, erro: unknown): Promise<void> {
  const texto = erro instanceof Error ? erro.message : String(erro);
  await sb.from("outbound_messages").update({ status: "failed", error: texto.slice(0, 500) }).eq("dedupe_key", chave);
}

/** Evento de fora (webhook, mensagem): true na primeira vez, false se já foi processado. */
export async function primeiraVezDoEvento(sb: SupabaseClient, provedor: string, eventoId: string, tipo?: string | null): Promise<boolean> {
  const { error } = await sb.from("processed_events").insert({ provider: provedor, event_id: eventoId, kind: tipo ?? null });
  if (!error) return true;
  if (error.code === "23505") return false;
  // Sem conseguir gravar, processa (o comportamento de antes) e deixa rastro no log.
  console.error("[idempotencia] processed_events:", error.message);
  return true;
}
