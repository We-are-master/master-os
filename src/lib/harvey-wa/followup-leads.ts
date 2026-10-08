/**
 * Follow-up de quem recebeu o primeiro contato e NUNCA respondeu (dono,
 * 08/10/2026). O chase do Harvey só cobra quem já conversou, dentro das 24h
 * do WhatsApp; depois disso só sai template. Para os leads da view 🎯 Leads:
 *
 *   24h  template quote_request_checkin ("just checking in about…")
 *   48h  nota "ligar para ele" e o ticket vai para a Action Required (🔴)
 *   7d   ticket resolvido como "no response"
 *
 * O estado mora no ticket do lead (tags lead_checkin_sent / lead_call /
 * lead_no_response). Respondeu em qualquer momento: o ticket do lead é juntado
 * no da conversa (fecha), e a varredura não mexe mais nele. Só de 8h às 21h de
 * Londres, dentro da janela de envio da tela do Harvey.
 *
 * Roda na rota /api/cron/harvey-wa (n8n a cada 10 min); ?dry-run=1 só lista.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { zendeskApi, addTicketTags, ZENDESK_REPLY_STATUS_FIELD_ID } from "@/lib/zendesk";
import { firstName } from "@/lib/agent/sales/lead-brief";
import { ajustesDoHarvey, janelaAberta } from "./ajustes";
import { externalIdDoLead, idDaIntegracaoWhatsApp } from "./primeiro-contato";
import { scNotificacao } from "./sunshine";

const H = 3_600_000;
const TEMPLATE_CHECKIN = process.env.HARVEY_WA_LEAD_CHECKIN_TEMPLATE?.trim() || "quote_request_checkin";
const RESOLUCAO = 5872761703199; // campo Resolution

export type ResultadoFollowup = { ensaio: boolean; olhados: number; checkin: string[]; ligar: string[]; fechados: string[]; pulados: string[] };

type Ticket = { id: number; status: string; tags: string[] };

async function ticketDoLead(leadExterno: string): Promise<Ticket | null> {
  const { tickets } = await zendeskApi<{ tickets: Ticket[] }>(`tickets.json?external_id=${encodeURIComponent(externalIdDoLead(leadExterno))}`);
  return tickets?.find((t) => !["solved", "closed"].includes(t.status)) ?? null;
}

async function nota(ticket: number, texto: string, extra: Record<string, unknown> = {}) {
  await zendeskApi(`tickets/${ticket}.json`, { method: "PUT", body: { ticket: { comment: { body: texto, public: false }, ...extra } } });
}

export async function varrerFollowupDeLeads(sb: SupabaseClient, { aplicar }: { aplicar: boolean }, agora = new Date()): Promise<ResultadoFollowup> {
  const out: ResultadoFollowup = { ensaio: !aplicar, olhados: 0, checkin: [], ligar: [], fechados: [], pulados: [] };
  if (!janelaAberta(await ajustesDoHarvey(), agora)) return out;
  const hora = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }).format(agora));
  if (hora < 8 || hora >= 21) return out;

  const { data: leads } = await sb
    .from("harvey_wa_leads")
    .select("chave, telefone, cliente_id, lead_externo, servico, enviado_em, origem")
    .not("lead_externo", "is", null)
    .lte("enviado_em", new Date(agora.getTime() - 24 * H).toISOString())
    .gte("enviado_em", new Date(agora.getTime() - 8 * 24 * H).toISOString())
    .limit(100);

  for (const l of leads ?? []) {
    if (l.origem === "site") continue;
    const idade = (agora.getTime() - new Date(l.enviado_em as string).getTime()) / H;
    // Respondeu? A conversa do WhatsApp tem mensagem dele depois do template.
    const { data: conv } = await sb.from("harvey_wa_conversas").select("cliente_em").eq("phone", l.telefone).maybeSingle();
    if (conv?.cliente_em && new Date(conv.cliente_em as string) > new Date(l.enviado_em as string)) continue;
    const t = await ticketDoLead(l.lead_externo as string).catch(() => null);
    if (!t) continue; // juntado (respondeu) ou já resolvido
    out.olhados++;
    const quem = `#${t.id} ${l.telefone}`;
    const tags = new Set(t.tags);
    if (tags.has("lead_no_response")) continue;

    if (idade >= 7 * 24 && tags.has("lead_call")) {
      out.fechados.push(quem);
      if (aplicar) {
        await nota(t.id, "No reply after the first message, the check-in and a call reminder. Solved as no response. It reopens by itself if they write.", {
          status: "solved",
          custom_fields: [{ id: RESOLUCAO, value: "res_no_response" }],
        });
        await addTicketTags(t.id, ["lead_no_response"]);
      }
      continue;
    }
    if (idade >= 48 && tags.has("lead_checkin_sent") && !tags.has("lead_call")) {
      out.ligar.push(quem);
      if (aplicar) {
        // 🔴 Reply: sai da view Leads (gatilho "Lead replied") e aparece na Action Required para alguém ligar.
        await nota(t.id, `📞 No reply to the first message or the check-in. Please call them on ${l.telefone}. If they don't pick up, the "missed_call_followup" template is in the WhatsApp templates.`, {
          custom_fields: [{ id: ZENDESK_REPLY_STATUS_FIELD_ID, value: "reply_awaiting" }],
        });
        await addTicketTags(t.id, ["lead_call"]);
      }
      continue;
    }
    if (!tags.has("lead_checkin_sent")) {
      out.checkin.push(quem);
      if (!aplicar) continue;
      const { data: c } = await sb.from("clients").select("full_name").eq("id", l.cliente_id).maybeSingle();
      const nome = firstName((c?.full_name as string | null) ?? null) ?? "there";
      const sobre = `your ${String(l.servico ?? "job").trim()} request`;
      try {
        await scNotificacao({
          destination: { integrationId: await idDaIntegracaoWhatsApp(), destinationId: l.telefone },
          author: { role: "appMaker" },
          messageSchema: "whatsapp",
          message: {
            type: "template",
            template: {
              namespace: process.env.HARVEY_WA_TEMPLATE_NAMESPACE?.trim() || "6ce5890e_770a_4be1_91db_7d34bc67e542",
              name: TEMPLATE_CHECKIN,
              language: { policy: "deterministic", code: process.env.HARVEY_WA_LEAD_TEMPLATE_LANG?.trim() || "en_GB" },
              components: [{ type: "body", parameters: [{ type: "text", text: nome }, { type: "text", text: sobre }] }],
            },
          },
          metadata: { origem: "lead_checkin", leadExterno: l.lead_externo },
        });
        await nota(t.id, `Follow-up sent on WhatsApp (${TEMPLATE_CHECKIN}): "Hi ${nome}, just checking in about ${sobre}. Are you still looking to get this done? …"\n\nNext action: wait for the reply. No reply in 24h: call them.`);
        await addTicketTags(t.id, ["lead_checkin_sent"]);
      } catch (e) {
        out.pulados.push(`${quem}: ${e instanceof Error ? e.message.slice(0, 120) : "falhou"}`);
      }
    }
  }
  return out;
}
