/**
 * Cobrança de quote enviada (Fase 2, dono 09/10/2026): ticket em 🟠 Approval em que
 * nós falamos por último recebe um lembrete com 24h e outro com 72h. Depois disso a
 * equipe decide. Respondeu, o Reply Status vira 🔴 e o ticket sai daqui sozinho.
 *
 *  - WhatsApp com a janela de 24h aberta: texto livre, na voz de quem estava falando
 *  - WhatsApp com a janela fechada: template `quote_request_checkin`
 *  - e-mail: comentário público no ticket
 *
 * Estado nas tags do ticket: `quote_chase_1`, `quote_chase_2`. Só 8h às 20h de Londres.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { zendeskApi, addTicketTags } from "@/lib/zendesk";
import { firstName } from "@/lib/agent/sales/lead-brief";
import { historico, scApi, scNotificacao } from "./sunshine";
import { idDaIntegracaoWhatsApp } from "./primeiro-contato";

const STATUS_APPROVAL = Number(process.env.ZENDESK_STATUS_APPROVAL?.trim() || "5688280626847");
const VIEW_QUOTING = Number(process.env.ZENDESK_VIEW_QUOTING?.trim() || "5685293799071");
const H = 3_600_000;

export type ResultadoQuotes = { ensaio: boolean; olhados: number; enviados: string[]; pulados: string[] };

type Ticket = { id: number; subject: string; tags: string[]; custom_status_id?: number; requester_id: number; via?: { channel?: string } };
type Comentario = { public: boolean; author_id: number; created_at: string; body?: string };

function horaDeLondres(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }).format(d));
}

export function estagioDaCobranca(tags: string[], horasDesdeNossa: number): 1 | 2 | null {
  if (tags.includes("quote_chase_2")) return null;
  // Contado da última mensagem nossa, que já é o 1º lembrete: +48h dá as 72h desde a quote.
  if (tags.includes("quote_chase_1")) return horasDesdeNossa >= 48 ? 2 : null;
  return horasDesdeNossa >= 24 ? 1 : null;
}

export function textoDaCobranca(estagio: 1 | 2, nome: string): string {
  return estagio === 1
    ? `Hi ${nome}, just checking you received our quote. If you're happy to go ahead, reply here with a day that suits you and we'll get it booked in. Any questions, just ask.`
    : `Hi ${nome}, following up on our quote one last time. Would you like us to go ahead, or would you like us to adjust anything? If you've decided not to go ahead, no problem at all, just let us know.`;
}

export async function varrerCobrancaDeQuotes(sb: SupabaseClient, { aplicar }: { aplicar: boolean }, agora = new Date()): Promise<ResultadoQuotes> {
  const out: ResultadoQuotes = { ensaio: !aplicar, olhados: 0, enviados: [], pulados: [] };
  const hora = horaDeLondres(agora);
  if (hora < 8 || hora >= 20) return out;

  const { tickets } = await zendeskApi<{ tickets: Ticket[] }>(`views/${VIEW_QUOTING}/tickets.json?per_page=100`);
  for (const t of tickets ?? []) {
    if (t.custom_status_id !== STATUS_APPROVAL) continue;
    out.olhados++;
    const { comments } = await zendeskApi<{ comments: Comentario[] }>(`tickets/${t.id}/comments.json?sort_order=desc&per_page=20`);
    const publicos = (comments ?? []).filter((c) => c.public);
    const ultima = publicos[0];
    if (!ultima) continue;
    const ehWhatsApp = t.tags.includes("harvey_wa") || t.via?.channel === "whatsapp";

    const { user } = await zendeskApi<{ user: { name?: string; phone?: string | null } }>(`users/${t.requester_id}.json`);
    const nome = firstName(user?.name ?? null) ?? "there";

    let horasDesdeNossa: number;
    let conversa: string | null = null;
    let janelaAberta = false;
    let voz: string | null = null;
    if (ehWhatsApp) {
      const tel = user?.phone ?? null;
      const { data: c } = tel ? await sb.from("harvey_wa_conversas").select("conversation_id").eq("phone", tel).maybeSingle() : { data: null };
      conversa = (c as { conversation_id?: string } | null)?.conversation_id ?? null;
      if (!conversa) { out.pulados.push(`#${t.id}: no conversation`); continue; }
      const msgs = await historico(conversa, 30);
      const ultimaMsg = msgs.at(-1);
      if (!ultimaMsg || ultimaMsg.author.type === "user") continue; // cliente falou por último: é com a equipe
      horasDesdeNossa = (agora.getTime() - new Date(ultimaMsg.received).getTime()) / H;
      const ultimaDoCliente = [...msgs].reverse().find((m) => m.author.type === "user");
      janelaAberta = !!ultimaDoCliente && agora.getTime() - new Date(ultimaDoCliente.received).getTime() < 23 * H;
      voz = ultimaMsg.author.displayName ?? null;
    } else {
      if (ultima.author_id === t.requester_id) continue;
      horasDesdeNossa = (agora.getTime() - new Date(ultima.created_at).getTime()) / H;
    }

    const estagio = estagioDaCobranca(t.tags, horasDesdeNossa);
    if (!estagio) continue;
    const quem = `#${t.id} ${t.subject.slice(0, 50)}`;
    if (!aplicar) { out.enviados.push(`${quem}: would send chase ${estagio}${ehWhatsApp ? (janelaAberta ? " (WhatsApp text)" : " (WhatsApp template)") : " (email)"}`); continue; }

    try {
      if (ehWhatsApp && janelaAberta && conversa) {
        await scApi(`/conversations/${conversa}/messages`, { method: "POST", body: { author: { type: "business", displayName: voz || "Fixfy" }, content: { type: "text", text: textoDaCobranca(estagio, nome) } } });
      } else if (ehWhatsApp) {
        await scNotificacao({
          destination: { integrationId: await idDaIntegracaoWhatsApp(), destinationId: user?.phone },
          author: { role: "appMaker" },
          messageSchema: "whatsapp",
          message: {
            type: "template",
            template: {
              namespace: process.env.HARVEY_WA_TEMPLATE_NAMESPACE?.trim() || "6ce5890e_770a_4be1_91db_7d34bc67e542",
              name: process.env.HARVEY_WA_LEAD_CHECKIN_TEMPLATE?.trim() || "quote_request_checkin",
              language: { policy: "deterministic", code: process.env.HARVEY_WA_LEAD_TEMPLATE_LANG?.trim() || "en_GB" },
              components: [{ type: "body", parameters: [{ type: "text", text: nome }, { type: "text", text: "the quote we sent you" }] }],
            },
          },
          metadata: { origem: "quote_chase", ticket: String(t.id) },
        });
      } else {
        await zendeskApi(`tickets/${t.id}.json`, { method: "PUT", body: { ticket: { comment: { public: true, body: `${textoDaCobranca(estagio, nome)}\n\nKind regards,\nFixfy Team` } } } });
      }
      await zendeskApi(`tickets/${t.id}.json`, { method: "PUT", body: { ticket: { comment: { public: false, body: `Quote chase ${estagio} sent automatically (${ehWhatsApp ? (janelaAberta ? "WhatsApp" : "WhatsApp template") : "email"}).${estagio === 2 ? " No more automatic chases: the team decides next." : ""}` } } } });
      await addTicketTags(t.id, [`quote_chase_${estagio}`]);
      out.enviados.push(`${quem}: chase ${estagio}`);
    } catch (e) {
      out.pulados.push(`${quem}: ${e instanceof Error ? e.message.slice(0, 100) : "failed"}`);
    }
  }
  return out;
}
