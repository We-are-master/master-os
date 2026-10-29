/**
 * A conversa do WhatsApp copiada, mensagem a mensagem, no ticket do job (dono, 26/10/2026).
 *
 * O morador da Housekeep responde o lembrete da véspera ("Ok", #51827) e o Zendesk abre
 * uma conversa nova, sem histórico e presa no "AI agent" (que não aceita nota, assunto nem
 * merge). O ticket do job é da plataforma e não entra na conversa (`ticketDoProprioCliente`),
 * então a equipe não via nada. Agora cada mensagem (do cliente, do Harvey e da equipe)
 * vira nota interna no ticket do job, na hora: o lembrete já está lá (📱) e a resposta cai
 * logo embaixo. Uma nota por mensagem (`outbound_messages`, chave `wa-no-job:<id>`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { zendeskApi, isZendeskConfigured } from "@/lib/zendesk";
import { confirmarEnvio, falhouEnvio, reservarEnvio } from "@/lib/idempotencia/envio";
import { escolherJobAtivo, type JobDoCliente } from "./job-ativo";
import { chaveDoTelefone } from "./identidade";
import { ehDoHarvey, type MensagemSc } from "./sunshine";

export type JobDaConversa = { ticketId: number; jobId: string; reference: string };

/** O job em andamento de quem tem este telefone (qualquer conta), com ticket no Zendesk. */
export async function jobPeloTelefone(sb: SupabaseClient, telefone: string | null): Promise<JobDaConversa | null> {
  const chave = chaveDoTelefone(telefone);
  if (!chave) return null;
  const fim = chave.slice(-4);
  const { data: clientes } = await sb.from("clients").select("id, phone").ilike("phone", `%${fim.slice(0, 2)}%${fim.slice(2)}`).is("deleted_at", null).limit(200);
  const ids = ((clientes ?? []) as Array<{ id: string; phone: string | null }>).filter((c) => chaveDoTelefone(c.phone) === chave).map((c) => c.id);
  if (!ids.length) return null;
  const { data: jobs } = await sb
    .from("jobs")
    .select("id, reference, status, scheduled_date, updated_at, external_source, external_ref")
    .in("client_id", ids)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(30);
  const lista = (jobs ?? []) as Array<JobDoCliente & { reference: string }>;
  const ativo = escolherJobAtivo(lista, new Date().toISOString().slice(0, 10));
  if (!ativo) return null;
  return { ...ativo, reference: lista.find((j) => j.id === ativo.jobId)?.reference ?? "" };
}

/** A linha da nota: quem falou e o que disse (mídia vira o tipo dela). */
export function linhaDaMensagem(msg: MensagemSc, nomeDoCliente: string | null): string {
  const quem = msg.author.type === "user" ? `💬 ${nomeDoCliente?.trim() || msg.author.displayName?.trim() || "Customer"}` : ehDoHarvey(msg) ? "🤖 Harvey" : `👤 ${msg.author.displayName?.trim() || "Fixfy team"}`;
  const texto = msg.content.text?.trim() || (msg.content.type === "image" ? "[photo]" : msg.content.type === "file" ? "[file]" : msg.content.type === "video" ? "[video]" : `[${msg.content.type}]`);
  return `${quem} on WhatsApp: ${texto}`;
}

export async function espelharMensagemNoJob(sb: SupabaseClient, a: { telefone: string | null; msg: MensagemSc; nomeDoCliente?: string | null; ticketDaConversa?: number | null }): Promise<string> {
  if (!isZendeskConfigured()) return "";
  const job = await jobPeloTelefone(sb, a.telefone);
  if (!job || job.ticketId === a.ticketDaConversa) return "";
  const chave = `wa-no-job:${a.msg.id}`;
  const reserva = await reservarEnvio(sb, { chave, finalidade: "wa-no-ticket-do-job", canal: "zendesk_note", jobId: job.jobId, ticketId: job.ticketId, motivo: "WhatsApp message copied to the job ticket" });
  if (!reserva.reservado) return "";
  try {
    await zendeskApi(`tickets/${job.ticketId}.json`, {
      method: "PUT",
      body: { ticket: { comment: { body: linhaDaMensagem(a.msg, a.nomeDoCliente ?? null), public: false } } },
    });
    await confirmarEnvio(sb, chave);
    return `#${job.ticketId} (${job.reference})`;
  } catch (e) {
    await falhouEnvio(sb, chave, e).catch(() => undefined);
    throw e;
  }
}
