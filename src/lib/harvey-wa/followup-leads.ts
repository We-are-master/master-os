/**
 * Follow-up de quem recebeu o primeiro contato e NUNCA respondeu (dono,
 * 08/10/2026; régua sem ligação desde 14/10/2026). O chase do Harvey só cobra
 * quem já conversou, dentro das 24h do WhatsApp; depois disso só sai template.
 * Para os leads da view 🎯 Leads:
 *
 *   24h  template quote_request_checkin ("just checking in about…")
 *   72h  e-mail de follow-up, se o lead tem e-mail (24h depois do check-in, no mínimo)
 *   7d   ticket resolvido como "no response"
 *
 * Ninguém liga mais (dono, 14/10/2026: a equipe não tem tempo para ligação). O
 * ticket fica na view Leads o tempo todo: nada aqui põe 🔴 nem manda para a
 * Action Required. Ele só sobe quando o cliente responde.
 *
 * O lead que veio só com e-mail (sem telefone) não está em harvey_wa_leads: o
 * ticket dele (tag lead_email_sent) recebe o mesmo e-mail no 3º dia e fecha no 7º.
 *
 * O estado mora no ticket do lead (tags lead_checkin_sent / lead_followup_email /
 * lead_no_response). Respondeu em qualquer momento: o ticket do lead é juntado
 * no da conversa (fecha), e a varredura não mexe mais nele. Só de 8h às 21h de
 * Londres, dentro da janela de envio da tela do Harvey.
 *
 * Roda na rota /api/cron/harvey-wa (n8n a cada 10 min); ?dry-run=1 só lista.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { zendeskApi, addTicketTags } from "@/lib/zendesk";
import { firstName } from "@/lib/agent/sales/lead-brief";
import { ajustesDoHarvey, janelaAberta } from "./ajustes";
import { externalIdDoLead, idDaIntegracaoWhatsApp } from "./primeiro-contato";
import { scNotificacao } from "./sunshine";

const H = 3_600_000;
const TEMPLATE_CHECKIN = process.env.HARVEY_WA_LEAD_CHECKIN_TEMPLATE?.trim() || "quote_request_checkin";
const RESOLUCAO = 5872761703199; // campo Resolution

export type ResultadoFollowup = { ensaio: boolean; olhados: number; checkin: string[]; email: string[]; fechados: string[]; pulados: string[] };

type Ticket = { id: number; status: string; tags: string[]; created_at?: string; requester_id?: number };

async function ticketDoLead(leadExterno: string): Promise<Ticket | null> {
  const { tickets } = await zendeskApi<{ tickets: Ticket[] }>(`tickets.json?external_id=${encodeURIComponent(externalIdDoLead(leadExterno))}`);
  return tickets?.find((t) => !["solved", "closed"].includes(t.status)) ?? null;
}

/** O WhatsApp que cai no Zendesk e no Harvey. */
const WHATSAPP_DA_FIXFY = "020 4538 4668";

/** O texto do e-mail do 3º dia. Curto, sem pressão, e com a saída fácil para quem já resolveu. */
export function emailDeFollowup(nome: string, servico: string): string {
  return [
    `Hi ${nome},`,
    "",
    `Just following up on your Checkatrade request for ${servico}. We'd love to help.`,
    "",
    `If you reply with a couple of photos of the job, we'll come back with a clear price, usually the same day. You can also message us on WhatsApp on ${WHATSAPP_DA_FIXFY}.`,
    "",
    "If you've already sorted it, no problem: just let us know and we'll close your request.",
    "",
    "Thank you,",
    "Fixfy Team",
  ].join("\n");
}

/** O requester é o cliente (tem e-mail dele), e não o e-mail da equipe que o ticket usa quando o lead veio sem e-mail. */
async function requesterEhCliente(t: Ticket): Promise<boolean> {
  if (!t.requester_id) return false;
  const { user } = await zendeskApi<{ user?: { email?: string | null } }>(`users/${t.requester_id}.json`);
  const email = String(user?.email ?? "").trim().toLowerCase();
  return email !== "" && !/@getfixfy\.com$/.test(email);
}

/** Quando saiu o check-in (a nota "Follow-up sent on WhatsApp"). Nulo se não achou. */
async function quandoSaiuOCheckin(ticket: number): Promise<Date | null> {
  const { comments } = await zendeskApi<{ comments?: Array<{ created_at: string; plain_body?: string; body?: string }> }>(`tickets/${ticket}/comments.json?sort_order=desc&per_page=30`);
  const c = (comments ?? []).find((x) => /Follow-up sent on WhatsApp/.test(String(x.plain_body ?? x.body ?? "")));
  return c ? new Date(c.created_at) : null;
}

/** E-mail do 3º dia como comentário público: a resposta do cliente cai no mesmo ticket. O ticket segue em Leads. */
async function mandarEmailDeFollowup(ticket: number, nome: string, servico: string) {
  await zendeskApi(`tickets/${ticket}.json`, { method: "PUT", body: { ticket: { comment: { body: emailDeFollowup(nome, servico), public: true }, status: "pending" } } });
  await addTicketTags(ticket, ["lead_followup_email"]);
}

async function nota(ticket: number, texto: string, extra: Record<string, unknown> = {}) {
  await zendeskApi(`tickets/${ticket}.json`, { method: "PUT", body: { ticket: { comment: { body: texto, public: false }, ...extra } } });
}

export async function varrerFollowupDeLeads(sb: SupabaseClient, { aplicar }: { aplicar: boolean }, agora = new Date()): Promise<ResultadoFollowup> {
  const out: ResultadoFollowup = { ensaio: !aplicar, olhados: 0, checkin: [], email: [], fechados: [], pulados: [] };
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

    if (idade >= 7 * 24 && tags.has("lead_checkin_sent")) {
      out.fechados.push(quem);
      if (aplicar) await fecharSemResposta(t.id);
      continue;
    }
    if (idade >= 72 && tags.has("lead_checkin_sent") && !tags.has("lead_followup_email")) {
      // 24h depois do check-in, no mínimo: lead antigo que recebeu o check-in agora não leva o e-mail 10 minutos depois.
      const checkin = await quandoSaiuOCheckin(t.id).catch(() => null);
      if (!checkin || agora.getTime() - checkin.getTime() < 24 * H) continue;
      if (!(await requesterEhCliente(t).catch(() => false))) continue;
      out.email.push(quem);
      if (aplicar) {
        const { data: c } = await sb.from("clients").select("full_name").eq("id", l.cliente_id).maybeSingle();
        const nome = firstName((c?.full_name as string | null) ?? null) ?? "there";
        await mandarEmailDeFollowup(t.id, nome, String(l.servico ?? "your job").trim()).catch((e) => out.pulados.push(`${quem}: ${e instanceof Error ? e.message.slice(0, 120) : "falhou"}`));
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
        await nota(t.id, `Follow-up sent on WhatsApp (${TEMPLATE_CHECKIN}): "Hi ${nome}, just checking in about ${sobre}. Are you still looking to get this done? …"\n\nNext action: wait for the reply. No reply by day 3: a follow-up email goes out (if we have their email). No reply in 7 days: solved as no response. The ticket stays in Leads, nobody needs to call.`);
        await addTicketTags(t.id, ["lead_checkin_sent"]);
      } catch (e) {
        out.pulados.push(`${quem}: ${e instanceof Error ? e.message.slice(0, 120) : "falhou"}`);
      }
    }
  }
  await varrerLeadsSoPorEmail(out, { aplicar }, agora);
  return out;
}

async function fecharSemResposta(ticket: number) {
  await nota(ticket, "No reply after the first message and the follow-ups. Solved as no response. It reopens by itself if they write.", {
    status: "solved",
    custom_fields: [{ id: RESOLUCAO, value: "res_no_response" }],
  });
  await addTicketTags(ticket, ["lead_no_response"]);
}

/** Lead que veio sem telefone: o primeiro contato foi e-mail (tag lead_email_sent). E-mail no 3º dia, fecha no 7º. */
async function varrerLeadsSoPorEmail(out: ResultadoFollowup, { aplicar }: { aplicar: boolean }, agora: Date) {
  const desde = new Date(agora.getTime() - 8 * 24 * H).toISOString().slice(0, 10);
  const q = `type:ticket tags:lead_email_sent status<solved created>${desde}`;
  const { results } = await zendeskApi<{ results?: Array<Ticket & { subject?: string; via?: { channel?: string } }> }>(`search.json?query=${encodeURIComponent(q)}`).catch(() => ({ results: [] }));
  for (const t of results ?? []) {
    const tags = new Set(t.tags);
    if (tags.has("lead_no_response") || !t.created_at) continue;
    // O cliente respondeu: o comentário mais novo não é nosso. A view Action Required cuida dele.
    const { comments } = await zendeskApi<{ comments?: Array<{ author_id: number; public: boolean }> }>(`tickets/${t.id}/comments.json?sort_order=desc&per_page=5`).catch(() => ({ comments: [] }));
    if ((comments ?? []).some((c) => c.public && c.author_id === t.requester_id)) continue;
    const idade = (agora.getTime() - new Date(t.created_at).getTime()) / H;
    out.olhados++;
    const quem = `#${t.id} e-mail`;
    if (idade >= 7 * 24) {
      out.fechados.push(quem);
      if (aplicar) await fecharSemResposta(t.id);
      continue;
    }
    if (idade >= 72 && !tags.has("lead_followup_email")) {
      out.email.push(quem);
      if (!aplicar) continue;
      const { user } = await zendeskApi<{ user?: { name?: string | null } }>(`users/${t.requester_id}.json`).catch(() => ({ user: undefined }));
      const nome = firstName(user?.name ?? null) ?? "there";
      const servico = String(t.subject ?? "").split("·")[1]?.trim().toLowerCase() || "your job";
      await mandarEmailDeFollowup(t.id, nome, servico).catch((e) => out.pulados.push(`${quem}: ${e instanceof Error ? e.message.slice(0, 120) : "falhou"}`));
    }
  }
}
