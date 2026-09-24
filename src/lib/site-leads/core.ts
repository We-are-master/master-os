/**
 * Leads do site: quem começou a reservar em getfixfy.com e não pagou.
 *
 * Três portas de escrita, todas aqui:
 *   registrarPasso   o site avisa a cada passo (1 a 4); cria ou atualiza o
 *                    lead aberto daquele e-mail e reagenda o que ainda não saiu
 *   registrarPagamento  a reserva foi paga: vira cliente, a sequência para
 *   mudarEstado / anotar  o time na aba Leads
 *
 * Um lead aberto por e-mail (índice único em 294): voltar e recomeçar mexe no
 * mesmo registro, e a sequência recomeça a contar do último movimento em vez de
 * mandar em dobro.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { agendaDoAbandono } from "@/lib/emails/reserva-abandonada";

export const ESTADOS_ABERTOS = ["new", "hot", "contacted"] as const;
export type EstadoDoLead = "new" | "hot" | "contacted" | "won" | "lost" | "unsubscribed";

export type PassoDoSite = {
  email: string;
  name?: string | null;
  phone?: string | null;
  postcode?: string | null;
  step: number;
  selection?: Record<string, unknown>;
  serviceLabel?: string | null;
  price?: number | null;
  resumeUrl?: string | null;
  source?: Record<string, unknown>;
  marketingOptOut?: boolean;
};

export type PagamentoDoSite = {
  email: string;
  jobId?: string | null;
  bookingRef?: string | null;
  total?: number | null;
  promoCode?: string | null;
};

const limpar = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

function emailValido(e: unknown): string | null {
  const s = limpar(e, 200)?.toLowerCase();
  return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

async function leadAberto(sb: SupabaseClient, email: string) {
  const { data } = await sb
    .from("site_leads")
    .select("*")
    .ilike("email", email)
    .in("status", ESTADOS_ABERTOS as unknown as string[])
    .limit(1)
    .maybeSingle();
  return data as Record<string, unknown> | null;
}

async function registrarAtividade(
  sb: SupabaseClient,
  leadId: string,
  kind: string,
  detail: string,
  extra: { meta?: Record<string, unknown>; providerId?: string | null; actorId?: string | null } = {},
) {
  await sb.from("site_lead_activity").insert({
    lead_id: leadId,
    kind,
    detail,
    meta: extra.meta ?? {},
    provider_id: extra.providerId ?? null,
    actor_id: extra.actorId ?? null,
  });
}

/** Horários dos e-mails que ainda não saíram, contados a partir de agora. */
function reagendar(lead: Record<string, unknown> | null, agora: Date) {
  const a = agendaDoAbandono(agora);
  return {
    email1_due_at: lead?.email1_sent_at ? lead.email1_due_at : a.email1.toISOString(),
    email2_due_at: lead?.email2_sent_at ? lead.email2_due_at : a.email2.toISOString(),
    email3_due_at: lead?.email3_sent_at ? lead.email3_due_at : a.email3.toISOString(),
  };
}

export async function registrarPasso(input: PassoDoSite, agora = new Date()) {
  const email = emailValido(input.email);
  if (!email) return { ok: false as const, error: "email inválido" };
  const passo = Math.max(1, Math.min(4, Math.round(Number(input.step) || 1)));
  const sb = createServiceClient();
  const existente = await leadAberto(sb, email);

  const { data: cliente } = await sb.from("clients").select("id").ilike("email", email).is("deleted_at", null).limit(1).maybeSingle();

  const passoAnterior = Number(existente?.step_reached ?? 0);
  const passoNovo = Math.max(passoAnterior, passo);
  const estadoAtual = (existente?.status as EstadoDoLead | undefined) ?? "new";
  const estado: EstadoDoLead = estadoAtual === "contacted" ? "contacted" : passoNovo >= 3 ? "hot" : "new";
  const pausado = existente?.sequence_state === "paused";

  const campos = {
    email,
    full_name: limpar(input.name, 120) ?? existente?.full_name ?? null,
    phone: limpar(input.phone, 40) ?? existente?.phone ?? null,
    postcode: limpar(input.postcode, 10)?.toUpperCase() ?? existente?.postcode ?? null,
    client_id: (cliente?.id as string | undefined) ?? existente?.client_id ?? null,
    selection: input.selection ?? existente?.selection ?? {},
    service_label: limpar(input.serviceLabel, 120) ?? existente?.service_label ?? null,
    price: input.price != null && Number.isFinite(Number(input.price)) ? Number(input.price) : existente?.price ?? null,
    resume_url: limpar(input.resumeUrl, 1000) ?? existente?.resume_url ?? null,
    source: existente?.source && Object.keys(existente.source as object).length ? existente.source : input.source ?? {},
    step_reached: passoNovo,
    last_activity_at: agora.toISOString(),
    updated_at: agora.toISOString(),
    status: estado,
    marketing_opt_out: Boolean(input.marketingOptOut) || Boolean(existente?.marketing_opt_out),
    ...(pausado ? {} : { sequence_state: "scheduled", ...reagendar(existente, agora) }),
  };

  if (existente) {
    const { error } = await sb.from("site_leads").update(campos).eq("id", existente.id as string);
    if (error) return { ok: false as const, error: error.message };
    if (passoNovo > passoAnterior) {
      await registrarAtividade(sb, existente.id as string, "step", `Reached step ${passoNovo}`, { meta: { step: passoNovo } });
    }
    return { ok: true as const, id: existente.id as string, created: false };
  }

  const { data, error } = await sb.from("site_leads").insert(campos).select("id").single();
  if (error || !data) return { ok: false as const, error: error?.message ?? "insert falhou" };
  await registrarAtividade(sb, data.id as string, "step", `Started a booking: ${campos.service_label ?? "service"} (step ${passoNovo})`, {
    meta: { step: passoNovo, source: campos.source },
  });
  return { ok: true as const, id: data.id as string, created: true };
}

/** A reserva foi paga: o lead aberto vira cliente e nada mais sai. */
export async function registrarPagamento(input: PagamentoDoSite, agora = new Date()) {
  const email = emailValido(input.email);
  if (!email) return { ok: false as const, error: "email inválido" };
  const sb = createServiceClient();
  const lead = await leadAberto(sb, email);
  if (!lead) return { ok: true as const, id: null, semLead: true };

  const recuperadoPor = lead.email3_sent_at ? "email 3" : lead.email2_sent_at ? "email 2" : lead.email1_sent_at ? "email 1" : null;
  await sb.from("site_leads").update({
    status: "won",
    sequence_state: "stopped",
    won_at: agora.toISOString(),
    job_id: input.jobId ?? null,
    booking_ref: limpar(input.bookingRef, 40),
    updated_at: agora.toISOString(),
  }).eq("id", lead.id as string);
  await registrarAtividade(
    sb,
    lead.id as string,
    "paid",
    `Paid${input.total != null ? ` £${Number(input.total).toFixed(2)}` : ""}${input.bookingRef ? ` (${input.bookingRef})` : ""}${recuperadoPor ? `, after ${recuperadoPor}` : ""}`,
    { meta: { jobId: input.jobId ?? null, promo: input.promoCode ?? null, recoveredBy: recuperadoPor } },
  );
  return { ok: true as const, id: lead.id as string };
}

/**
 * O time muda o estado na aba. "Em contato" pausa a sequência (não atropela a
 * conversa); perdido e descadastrado param de vez; voltar para novo/quente
 * retoma de onde parou.
 */
export async function mudarEstado(
  sb: SupabaseClient,
  leadId: string,
  estado: EstadoDoLead,
  opts: { motivo?: string | null; actorId?: string | null } = {},
) {
  const sequencia =
    estado === "contacted" ? "paused" : estado === "won" || estado === "lost" || estado === "unsubscribed" ? "stopped" : "scheduled";
  const { error } = await sb.from("site_leads").update({
    status: estado,
    sequence_state: sequencia,
    lost_reason: estado === "lost" ? limpar(opts.motivo, 200) : null,
    updated_at: new Date().toISOString(),
  }).eq("id", leadId);
  if (error) return { ok: false as const, error: error.message };
  const rotulo: Record<EstadoDoLead, string> = {
    new: "New", hot: "Hot", contacted: "In contact", won: "Customer", lost: "Lost", unsubscribed: "Opted out",
  };
  await registrarAtividade(sb, leadId, "status", `Status: ${rotulo[estado]}${estado === "lost" && opts.motivo ? ` (${opts.motivo})` : ""}`, {
    actorId: opts.actorId,
  });
  return { ok: true as const };
}

export async function anotar(sb: SupabaseClient, leadId: string, texto: string, actorId?: string | null) {
  const t = limpar(texto, 2000);
  if (!t) return { ok: false as const, error: "nota vazia" };
  await registrarAtividade(sb, leadId, "note", t, { actorId });
  return { ok: true as const };
}

export { registrarAtividade };
