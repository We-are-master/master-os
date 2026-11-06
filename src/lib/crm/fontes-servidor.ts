/**
 * Fontes do funil no servidor (fase 5 do CRM): reserva abandonada que
 * respondeu, primeiro contato do Harvey e as mensagens do WhatsApp.
 *
 * Tudo aqui é contabilidade do CRM: nunca derruba quem chamou (o motor do
 * site, o Harvey) e nunca manda mensagem para ninguém.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lead, LeadEventActor } from "@/types/database";
import { chaveDoTelefone } from "@/lib/harvey-wa/identidade";
import { leadDoSiteLead, type SiteLeadParaCrm } from "./fontes";
import { acharLeadPorTicket, marcarRespostaDoCliente, marcarRespostaNossa, moverEtapa, registrarEvento } from "./lead-servidor";

const ETAPAS_VIVAS = ["new", "qualifying", "qualified", "quoting", "quoted"];

/** O lead vivo mais recente do cliente (etapa aberta ou Nurture). */
async function leadVivoDoCliente(sb: SupabaseClient, clientId: string | null | undefined): Promise<{ id: string; stage: string; job_id: string | null; external_ref: string | null } | null> {
  if (!clientId) return null;
  const { data } = await sb
    .from("leads")
    .select("id, stage, job_id, external_ref")
    .eq("client_id", clientId)
    .in("stage", ETAPAS_VIVAS)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string; stage: string; job_id: string | null; external_ref: string | null } | null) ?? null;
}

/**
 * A reserva abandonada respondeu: cria (ou acha) o lead do CRM em Talking e
 * guarda o vínculo em site_leads.lead_id (mig 357). Antes de responder, nada
 * (decisão do dono). Devolve o id do lead, ou null se não deu.
 */
export async function leadDaReservaQueRespondeu(
  sb: SupabaseClient,
  site: SiteLeadParaCrm & { lead_id?: string | null },
  r: { ticketId: number | null; quando: string },
): Promise<string | null> {
  try {
    if (site.lead_id) return site.lead_id;
    const ticket = site.zendesk_ticket_id ?? r.ticketId;
    const porTicket = ticket ? await acharLeadPorTicket(sb, ticket) : null;
    const existente = porTicket ?? (await leadVivoDoCliente(sb, site.client_id));
    let leadId = existente?.id ?? null;
    if (existente) {
      if (existente.stage === "new") await moverEtapa(sb, existente as Pick<Lead, "id" | "stage" | "job_id">, { to: "qualifying", actorType: "customer", channel: "zendesk", summary: "Customer replied to the website follow-up" });
      if (!existente.external_ref && ticket) {
        await sb.from("leads").update({ external_source: "zendesk", external_ref: String(ticket) }).eq("id", existente.id).is("external_ref", null);
      }
    } else {
      const { data: ref, error: refErr } = await sb.rpc("next_lead_ref");
      if (refErr || !ref) throw new Error(refErr?.message ?? "no lead reference");
      const { data, error } = await sb
        .from("leads")
        .insert({ reference: String(ref), ...leadDoSiteLead(site, ticket) })
        .select("id")
        .single();
      if (error || !data) throw new Error(error?.message ?? "lead insert");
      leadId = data.id as string;
      await registrarEvento(sb, {
        leadId,
        kind: "created",
        channel: "zendesk",
        actorType: "system",
        toStage: "qualifying",
        summary: "Lead created · website (abandoned booking, customer replied)",
        payload: { site_lead_id: site.id, ticket_id: ticket ?? null },
        idempotencyKey: `created:site_lead:${site.id}`,
      });
    }
    if (!leadId) return null;
    const { error: linkErr } = await sb.from("site_leads").update({ lead_id: leadId }).eq("id", site.id).is("lead_id", null);
    if (linkErr) console.warn("[crm] site_leads.lead_id (mig 357?):", linkErr.message);
    await marcarRespostaDoCliente(sb, { leadId, at: r.quando, channel: "zendesk", eventoId: `site_lead:${site.id}:${r.quando}` });
    return leadId;
  } catch (e) {
    console.warn("[crm] reserva que respondeu", site.id, e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * O ticket do primeiro contato do Harvey nasceu: o lead do cliente (gravado
 * antes por registrarLeadNoOs, sem ticket) passa a apontar para ele, e a linha
 * do harvey_wa_leads guarda o lead (mig 357).
 */
export async function ligarTicketAoLeadDoCliente(
  sb: SupabaseClient,
  input: { clientId: string; ticketId: number | string | null; telefone?: string | null },
): Promise<string | null> {
  try {
    const lead = await leadVivoDoCliente(sb, input.clientId);
    if (!lead) return null;
    const ticket = String(input.ticketId ?? "").trim();
    if (/^\d+$/.test(ticket) && !lead.external_ref) {
      const { error } = await sb
        .from("leads")
        .update({ external_source: "zendesk", external_ref: ticket, updated_at: new Date().toISOString() })
        .eq("id", lead.id)
        .is("external_ref", null);
      // Outro lead já tem esse ticket (índice único): fica como está.
      if (error) console.warn("[crm] ticket do lead:", error.message);
    }
    if (input.telefone) {
      const { error } = await sb.from("harvey_wa_leads").update({ lead_id: lead.id }).eq("chave", chaveDoTelefone(input.telefone));
      if (error) console.warn("[crm] harvey_wa_leads.lead_id (mig 357?):", error.message);
    }
    return lead.id;
  } catch (e) {
    console.warn("[crm] ligar ticket ao lead", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Quem escreveu a mensagem do WhatsApp, do ponto de vista do lead. */
export type AutorDaMensagem = "cliente" | "harvey" | "equipe" | "sistema";

/** O lead da conversa: pelo ticket, pela linha do primeiro contato, pelo cliente. */
async function leadDaConversa(sb: SupabaseClient, c: { ticketId?: number | string | null; telefone?: string | null; clientId?: string | null }): Promise<string | null> {
  if (c.ticketId) {
    const l = await acharLeadPorTicket(sb, c.ticketId);
    if (l) return l.id;
  }
  if (c.telefone) {
    const { data } = await sb.from("harvey_wa_leads").select("lead_id").eq("chave", chaveDoTelefone(c.telefone)).maybeSingle();
    const id = (data as { lead_id?: string | null } | null)?.lead_id ?? null;
    if (id) return id;
  }
  return (await leadVivoDoCliente(sb, c.clientId))?.id ?? null;
}

/**
 * Cada mensagem da conversa do WhatsApp (webhook da Sunshine, motor do Harvey):
 * cliente escreveu → resposta pendente; Harvey, equipe ou template → nossa.
 * Idempotente pelo id da mensagem (a Sunshine reenvia evento).
 */
export async function sinalDaMensagemWhatsApp(
  sb: SupabaseClient,
  m: { autor: AutorDaMensagem; mensagemId: string; quando?: string | null; texto?: string | null; telefone?: string | null; clientId?: string | null; ticketId?: number | string | null },
): Promise<void> {
  try {
    const leadId = await leadDaConversa(sb, m);
    if (!leadId) return;
    const at = m.quando ?? new Date().toISOString();
    if (m.autor === "cliente") {
      await marcarRespostaDoCliente(sb, { leadId, at, channel: "whatsapp", resumo: m.texto ?? null, eventoId: `wa:${m.mensagemId}` });
      return;
    }
    if (m.autor === "sistema") {
      // Template ou lembrete automático: conta como contato, não como resposta ao cliente.
      const novo = await registrarEvento(sb, {
        leadId,
        kind: "message_out",
        channel: "whatsapp",
        actorType: "system",
        summary: m.texto ? m.texto.slice(0, 280) : null,
        idempotencyKey: `out:${leadId}:wa:${m.mensagemId}`,
      });
      if (novo) await sb.from("leads").update({ last_contact_at: at }).eq("id", leadId);
      return;
    }
    const actorType: LeadEventActor = m.autor === "harvey" ? "harvey" : "staff";
    await marcarRespostaNossa(sb, { leadId, at, channel: "whatsapp", actorType, resumo: m.texto ?? null, eventoId: `wa:${m.mensagemId}` });
  } catch (e) {
    console.warn("[crm] mensagem do WhatsApp", e instanceof Error ? e.message : e);
  }
}
