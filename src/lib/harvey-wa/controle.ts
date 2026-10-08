/**
 * Assumir e devolver uma conversa do Harvey no WhatsApp. Uma lógica só para a
 * tela do OS (/harvey-whatsapp) e para o app da barra lateral do Zendesk.
 *
 *   assumir  → a conversa vai para o Agent Workspace (o ticket destrava) e o Harvey sai
 *   devolver → a conversa volta para o Harvey
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { zendeskApi } from "@/lib/zendesk";
import { devolverAoHarvey, historico, INTEGRACAO_HARVEY, passarParaEquipe, type MensagemSc } from "./sunshine";
import { grupoDaConversa } from "./zendesk-wa";

export async function assumirConversa(sb: SupabaseClient, conversationId: string, quem: string, onde: string) {
  const agora = new Date().toISOString();
  await passarParaEquipe(conversationId, `${quem} took over from ${onde}`);
  await sb.from("harvey_wa_conversas").update({ estado: "equipe", passou_em: agora, motivo_passagem: `${quem} took over`, chases: 3, atualizado_em: agora }).eq("conversation_id", conversationId);
  await moverGrupo(sb, conversationId, false);
  // Assumiu pelo botão: o ticket deixa de ser "AI agent" e o do lead entra nele.
  const { data } = await sb.from("harvey_wa_conversas").select("phone").eq("conversation_id", conversationId).maybeSingle();
  const { juntarTicketAnterior } = await import("./motor");
  await juntarTicketAnterior((data?.phone as string | null) ?? null, true).catch((e) => console.error("[harvey-wa] juntar ao assumir:", e));
}

/** O botão (Assumir / Give back) também move o ticket de grupo, sem esperar mensagem nova. */
async function moverGrupo(sb: SupabaseClient, conversationId: string, comHarvey: boolean) {
  const { data } = await sb.from("harvey_wa_conversas").select("phone, tipo").eq("conversation_id", conversationId).maybeSingle();
  if (data?.phone && data.tipo !== "parceiro") await grupoDaConversa(data.phone as string, comHarvey).catch((e) => console.error("[harvey-wa] grupo:", e));
}

/**
 * Give back: a conversa volta para o Harvey (dono, 08/10/2026: "o Harvey não
 * está agindo"). Antes ela voltava com o chase desligado (chases 3) e sem as
 * horas da conversa, então ele nunca cobrava; e se o cliente tinha falado por
 * último, ninguém respondia até ele escrever de novo. Agora:
 *  - as horas saem da conversa de verdade e o chase recomeça (1h, 4h, 20h);
 *  - cliente falou por último: o Harvey responde na hora, no nome de quem atendia.
 */
export async function devolverConversa(sb: SupabaseClient, conversationId: string) {
  const agora = new Date().toISOString();
  await devolverAoHarvey(conversationId);
  const msgs = await historico(conversationId, 40).catch(() => [] as MensagemSc[]);
  const ultimaDoCliente = [...msgs].reverse().find((m) => m.author.type === "user");
  const ultimaNossa = [...msgs].reverse().find((m) => m.author.type === "business");
  await sb
    .from("harvey_wa_conversas")
    .update({
      estado: "harvey",
      passou_em: null,
      motivo_passagem: null,
      chases: 0,
      ...(ultimaDoCliente ? { cliente_em: ultimaDoCliente.received } : {}),
      harvey_em: ultimaNossa?.received ?? null,
      atualizado_em: agora,
    })
    .eq("conversation_id", conversationId);
  await moverGrupo(sb, conversationId, true);
  const ultima = msgs.at(-1);
  if (ultima?.author.type === "user") {
    // A mensagem já passou pelo motor (pausado ou com a equipe): sai da trava de repetida para ele responder agora.
    await sb.from("harvey_wa_mensagens").delete().eq("message_id", ultima.id);
    const { processarEvento } = await import("./motor");
    await processarEvento({ type: "conversation:message", payload: { conversation: { id: conversationId, activeSwitchboardIntegration: { name: INTEGRACAO_HARVEY } }, message: ultima } }).catch((e) =>
      console.error("[harvey-wa] resposta no give back:", e),
    );
  }
}

export type ConversaDoTicket = { conversation_id: string; estado: string; name: string | null; phone: string | null };

/**
 * A conversa do Harvey por trás de um ticket de WhatsApp do Zendesk: o
 * telefone de quem abriu o ticket, igual ao guardado em harvey_wa_conversas
 * ("+" e só dígitos). Se a pessoa tiver mais de uma, vale a mais recente.
 */
export async function conversaDoTicket(sb: SupabaseClient, ticketId: number): Promise<ConversaDoTicket | null> {
  const { ticket } = await zendeskApi<{ ticket: { requester_id: number | null } }>(`tickets/${ticketId}.json`);
  if (!ticket?.requester_id) return null;
  const [{ user }, { identities }] = await Promise.all([
    zendeskApi<{ user: { phone: string | null } }>(`users/${ticket.requester_id}.json`),
    zendeskApi<{ identities: Array<{ type: string; value: string }> }>(`users/${ticket.requester_id}/identities.json`),
  ]);
  const telefones = new Set<string>();
  for (const v of [user?.phone, ...(identities ?? []).filter((i) => i.type === "phone_number").map((i) => i.value)]) {
    const d = String(v ?? "").replace(/\D/g, "");
    if (d.length >= 10) telefones.add(`+${d}`);
  }
  if (!telefones.size) return null;
  const { data } = await sb
    .from("harvey_wa_conversas")
    .select("conversation_id, estado, name, phone")
    .in("phone", [...telefones])
    .order("atualizado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ConversaDoTicket | null) ?? null;
}
