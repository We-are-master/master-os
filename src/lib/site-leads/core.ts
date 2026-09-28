/**
 * Leads do site: quem começou a reservar em getfixfy.com e não pagou.
 *
 * As portas de escrita, todas aqui:
 *   registrarPasso   o site avisa a cada passo (1 a 4); cria ou atualiza o
 *                    lead aberto daquele e-mail e reagenda o que ainda não saiu
 *                    (horários em agenda.ts)
 *   registrarPagamento  a reserva foi paga: vira cliente, a sequência para
 *   registrarResposta   o cliente respondeu (Zendesk): para e vira "em contato"
 *   mudarEstado / anotar  o time na aba Leads
 *
 * Um lead aberto por e-mail (índice único em 294): voltar e recomeçar mexe no
 * mesmo registro, e a sequência recomeça a contar do último movimento em vez de
 * mandar em dobro.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { bloquear } from "@/lib/marketing/suppressions";
import { toWhatsAppNumber } from "@/lib/whatsapp/cloud";
import { planoDaSequencia, type Passo } from "@/lib/site-leads/agenda";
import { leadTemWhatsApp } from "@/lib/site-leads/whatsapp-lead";
import { anotarNoTicket, type Resposta } from "@/lib/site-leads/zendesk-lead";

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

const TAG_RAPIDO = "teste-rapido";
const COLUNA_VENCE: Record<Passo, string> = { 1: "email1_due_at", 2: "email2_due_at", 3: "email3_due_at", 4: "whatsapp_due_at" };
const COLUNA_ENVIO: Record<Passo, string> = { 1: "email1_sent_at", 2: "email2_sent_at", 3: "email3_sent_at", 4: "whatsapp_sent_at" };

const data = (v: unknown): Date | null => (typeof v === "string" && v ? new Date(v) : v instanceof Date ? v : null);

/** O que já saiu, com a hora real do envio. */
export function enviadosDoLead(l: Record<string, unknown> | null): Partial<Record<Passo, Date | null>> {
  return { 1: data(l?.email1_sent_at), 2: data(l?.email2_sent_at), 3: data(l?.email3_sent_at), 4: data(l?.whatsapp_sent_at) };
}

/** Lead em teste de ponta a ponta do dono (etiqueta posta pelo scripts/reserva-abandonada-teste.mts --rapido). */
export function modoRapido(l: Record<string, unknown> | null): boolean {
  return Array.isArray(l?.tags) && (l.tags as unknown[]).includes(TAG_RAPIDO);
}

/**
 * Os horários de tudo o que ainda não saiu (agenda.ts), a partir do que já
 * saiu e do último movimento no site. O que já saiu mantém o horário gravado.
 */
export function horariosDoQueFalta(
  lead: Record<string, unknown> | null,
  parouEm: Date,
  opcoes: { enviados?: Partial<Record<Passo, Date | null>>; comWhatsApp?: boolean; phone?: string | null } = {},
): Record<string, string | null> {
  const enviados = opcoes.enviados ?? enviadosDoLead(lead);
  const comWhatsApp = opcoes.comWhatsApp ?? leadTemWhatsApp((opcoes.phone ?? lead?.phone) as string | null | undefined);
  const plano = planoDaSequencia({ parouEm, enviados, comWhatsApp, rapido: modoRapido(lead) });
  const campos: Record<string, string | null> = {};
  for (const passo of [1, 2, 3, 4] as const) {
    if (!enviados[passo]) campos[COLUNA_VENCE[passo]] = plano[passo]?.toISOString() ?? null;
  }
  return campos;
}

/** Horários do que ainda não saiu, contados a partir de agora (a pessoa acabou de se mexer no site). */
function reagendar(lead: Record<string, unknown> | null, agora: Date, phone: string | null) {
  return horariosDoQueFalta(lead, agora, { phone });
}

/**
 * A 302 acrescenta `whatsapp_due_at`. Se o código novo subir antes dela rodar,
 * gravar o lead do site não pode quebrar: tenta de novo sem a coluna nova.
 */
function semColunaNova(erro: { message?: string } | null, campos: Record<string, unknown>): Record<string, unknown> | null {
  if (!erro?.message || !/whatsapp_due_at/.test(erro.message) || !("whatsapp_due_at" in campos)) return null;
  const { whatsapp_due_at: _fora, ...resto } = campos;
  void _fora;
  return resto;
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
  const phone = limpar(input.phone, 40) ?? (existente?.phone as string | null | undefined) ?? null;

  const campos: Record<string, unknown> = {
    email,
    full_name: limpar(input.name, 120) ?? existente?.full_name ?? null,
    phone,
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
    ...(pausado ? {} : { sequence_state: "scheduled", ...reagendar(existente, agora, phone) }),
  };

  if (existente) {
    let { error } = await sb.from("site_leads").update(campos).eq("id", existente.id as string);
    const semNova = semColunaNova(error, campos);
    if (semNova) ({ error } = await sb.from("site_leads").update(semNova).eq("id", existente.id as string));
    if (error) return { ok: false as const, error: error.message };
    if (passoNovo > passoAnterior) {
      await registrarAtividade(sb, existente.id as string, "step", `Reached step ${passoNovo}`, { meta: { step: passoNovo } });
    }
    return { ok: true as const, id: existente.id as string, created: false };
  }

  let { data, error } = await sb.from("site_leads").insert(campos).select("id").single();
  const semNova = semColunaNova(error, campos);
  if (semNova) ({ data, error } = await sb.from("site_leads").insert(semNova).select("id").single());
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

  const recuperadoPor = lead.whatsapp_sent_at
    ? "WhatsApp"
    : lead.email3_sent_at ? "email 3" : lead.email2_sent_at ? "email 2" : lead.email1_sent_at ? "email 1" : null;
  await sb.from("site_leads").update({
    status: "won",
    sequence_state: "stopped",
    won_at: agora.toISOString(),
    job_id: input.jobId ?? null,
    booking_ref: limpar(input.bookingRef, 40),
    updated_at: agora.toISOString(),
  }).eq("id", lead.id as string);
  const texto = `Paid${input.total != null ? ` £${Number(input.total).toFixed(2)}` : ""}${input.bookingRef ? ` (${input.bookingRef})` : ""}${recuperadoPor ? `, after ${recuperadoPor}` : ""}`;
  await registrarAtividade(sb, lead.id as string, "paid", texto, {
    meta: { jobId: input.jobId ?? null, promo: input.promoCode ?? null, recoveredBy: recuperadoPor },
  });
  // O ticket do lead fica sabendo, para ninguém ligar para quem já pagou. Nunca derruba o aviso de pagamento.
  if (lead.zendesk_ticket_id) await anotarNoTicket(lead.zendesk_ticket_id as number, `${texto}. The booking was paid on the website: no more automatic touches.`);
  return { ok: true as const, id: lead.id as string };
}

export type RespostaDoCliente = Pick<Resposta, "tipo" | "quando" | "ticketId" | "pedidoDeSaida">;

/**
 * O cliente respondeu (ou o time falou com ele no ticket): a sequência para
 * e o lead vira "em contato", para o time assumir. Pedido de saída ("Stop
 * promotions", STOP) vira descadastro, nas duas listas de bloqueio.
 */
export async function registrarResposta(sb: SupabaseClient, lead: Record<string, unknown>, r: RespostaDoCliente, agora = new Date()) {
  const aberto = ["new", "hot"].includes(String(lead.status));
  const campos: Record<string, unknown> = { updated_at: agora.toISOString() };
  if (r.tipo === "cliente") campos.replied_at = r.quando;
  if (aberto) {
    campos.sequence_state = "stopped";
    campos.status = r.pedidoDeSaida ? "unsubscribed" : "contacted";
  }
  if (r.pedidoDeSaida) campos.marketing_opt_out = true;
  const { error } = await sb.from("site_leads").update(campos).eq("id", lead.id as string);
  if (error) return { ok: false as const, error: error.message };

  const onde = Number(lead.zendesk_ticket_id) === r.ticketId ? `in its Zendesk ticket #${r.ticketId}` : `in Zendesk ticket #${r.ticketId}`;
  const texto = r.pedidoDeSaida
    ? `Asked to stop promotions ${onde}. Opted out, automatic touches stopped.`
    : r.tipo === "cliente"
      ? `Customer replied ${onde}. Automatic touches stopped.`
      : `The team replied to the customer ${onde}. Automatic touches stopped.`;
  await registrarAtividade(sb, lead.id as string, "reply", texto, { meta: { ticket: r.ticketId, tipo: r.tipo, at: r.quando } });

  const email = String(lead.email ?? "").toLowerCase();
  if (r.tipo === "cliente" && email) {
    // O painel de marketing conta a resposta no último toque da sequência.
    const { data: toque } = await sb
      .from("marketing_touches")
      .select("id")
      .like("campaign", "reserva-abandonada:%")
      .eq("email", email)
      .is("replied_at", null)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (toque) await sb.from("marketing_touches").update({ replied_at: r.quando }).eq("id", toque.id);
  }
  if (r.pedidoDeSaida) {
    // Sair de uma camada é sair de todas (suppressions.ts).
    if (email) await bloquear(email, "unsubscribed", "reserva-abandonada").catch(() => undefined);
    const fone = toWhatsAppNumber(lead.phone as string | null | undefined);
    if (fone) {
      await sb
        .from("whatsapp_suppressions")
        .upsert({ phone: fone, reason: "stopped", source: "reserva-abandonada" }, { onConflict: "phone", ignoreDuplicates: true });
    }
  }
  return { ok: true as const };
}

/**
 * O que o teste de ponta a ponta do dono grava no lead dele
 * (scripts/reserva-abandonada-teste.mts): o próximo toque vence AGORA e o
 * resto segue a agenda. Com `rapido`, a etiqueta `teste-rapido` faz cada passo
 * vencer logo que o anterior sai (sem a folga de 12 h e sem a janela). Com
 * `doZero`, esquece o que já saiu (e a resposta, o código) e recomeça; o
 * ticket do lead continua o mesmo.
 */
export function horariosDoTesteDePonta(
  l: Record<string, unknown>,
  agora: Date,
  opcoes: { rapido: boolean; doZero: boolean },
): Record<string, unknown> {
  const semRapido = Array.isArray(l.tags) ? (l.tags as unknown[]).map(String).filter((t) => t !== TAG_RAPIDO) : [];
  const tags = opcoes.rapido ? [...semRapido, TAG_RAPIDO] : semRapido;
  const zerado: Record<string, unknown> = opcoes.doZero
    ? {
        email1_sent_at: null, email2_sent_at: null, email3_sent_at: null, whatsapp_sent_at: null,
        promo_code: null, promo_id: null, promo_expires_at: null, replied_at: null,
        status: Number(l.step_reached) >= 3 ? "hot" : "new",
        last_activity_at: agora.toISOString(),
      }
    : {};
  const base = { ...l, ...zerado, tags };
  const enviados = enviadosDoLead(base);
  const horarios = horariosDoQueFalta(base, agora, { enviados });
  const proximo = ([1, 2, 3, 4] as const).find((p) => !enviados[p] && horarios[COLUNA_VENCE[p]] != null);
  if (proximo) horarios[COLUNA_VENCE[proximo]] = agora.toISOString();
  return { ...zerado, ...horarios, tags, sequence_state: "scheduled", updated_at: agora.toISOString() };
}

export { COLUNA_ENVIO, COLUNA_VENCE, TAG_RAPIDO };

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
