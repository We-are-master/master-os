/**
 * Um ticket do Zendesk por lead do site, e as respostas do cliente.
 *
 * O ticket nasce quando o e-mail 1 sai, no molde de todo ticket aberto pelo OS
 * (jobs/route.ts): solicitante `team@getfixfy.com` e nota INTERNA na criação,
 * para gatilho nenhum escrever ao cliente, e só depois o cliente vira o
 * solicitante. Tags `os-created` (o Harvey pula ticket do OS: sem ela ele leria
 * o lead como pedido de cotação e responderia ao cliente), `site-lead` e
 * `reserva-abandonada`; Reply Status = Sent, como os outros tickets do OS.
 *
 * As respostas voltam para ESTE ticket por dois caminhos documentados pelo
 * Zendesk ("How are incoming emails threaded to tickets?", atualizado em
 * 22/06/2026):
 *   - o reply-to dos e-mails é o endereço do ticket,
 *     `support+id<encoded_id>@<subdomínio>.zendesk.com` (só vale para endereço
 *     do próprio Zendesk; a conta tem `support@fixfy.zendesk.com` verificado);
 *   - o encoded id vai escondido no corpo, entre colchetes, como o Zendesk faz
 *     nos e-mails dele ("Any email body can include an encoded ID"). É o que o
 *     site já usa na confirmação de compra para a resposta ao hello@ cair no
 *     ticket da reserva.
 *
 * Antes de cada toque o motor ainda procura resposta fora do ticket: ticket
 * novo do mesmo e-mail (quem escreveu do zero para o hello@) e conversa de
 * WhatsApp do mesmo número (o Zendesk abre um ticket `via:whatsapp` por
 * conversa, e `requester:+44…` acha: medido em 28/09/2026).
 *
 * Tag só com `addTicketTags` (lê, une e grava): gravar a lista direto apaga as
 * tags dos outros ([[zendesk-tags-duas-armadilhas]]).
 */

import {
  createTicket,
  isZendeskConfigured,
  setTicketRequester,
  updateTicket,
  ZENDESK_REPLY_STATUS_FIELD_ID,
  ZENDESK_REPLY_STATUS_SENT_VALUE,
} from "@/lib/zendesk";
import { appBaseUrl } from "@/lib/app-base-url";
import { toWhatsAppNumber } from "@/lib/whatsapp/cloud";
import { ehPedidoDeSaida } from "@/lib/marketing/whatsapp";

export const TAGS_DO_TICKET = ["os-created", "site-lead", "reserva-abandonada"];
const SOLICITANTE_PROVISORIO = { email: "team@getfixfy.com", nome: "Fixfy Team" };

/** Os campos do lead que o Zendesk usa. Soltos de propósito, como no motor. */
export type LeadParaZendesk = {
  id: string;
  email?: string | null;
  full_name?: string | null;
  phone?: string | null;
  postcode?: string | null;
  client_id?: string | null;
  selection?: unknown;
  service_label?: string | null;
  price?: number | string | null;
  resume_url?: string | null;
  source?: unknown;
  step_reached?: number | null;
  zendesk_ticket_id?: number | string | null;
};

// ---------------------------------------------------------------- texto (puro)

/** "SE12 8AA" → "SE12"; "se128aa" → "SE12". Null quando não parece postcode do UK. */
export function codigoDeSaida(postcode: string | null | undefined): string | null {
  const limpo = String(postcode ?? "").toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
  if (!limpo) return null;
  const junto = limpo.replace(/\s+/g, "");
  const saida = limpo.includes(" ") ? limpo.split(/\s+/)[0] : junto.length > 4 ? junto.slice(0, -3) : junto;
  return /^[A-Z]{1,2}\d[A-Z\d]?$/.test(saida) ? saida : null;
}

function comMaiuscula(s: string): string {
  const t = s.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** "Website booking not finished · 2 bed deep clean · SE12". */
export function assuntoDoTicket(l: LeadParaZendesk): string {
  const partes = ["Website booking not finished", comMaiuscula(String(l.service_label || "booking"))];
  const saida = codigoDeSaida(l.postcode);
  if (saida) partes.push(saida);
  return partes.join(" · ").slice(0, 150);
}

const PASSOS_DO_SITE = ["Your job", "Details", "Date and access", "Checkout"];

function libras(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `£${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })}` : "not priced";
}

/** A seleção do site em uma linha: "services clean · kind deep · size 2 · bathrooms 2 · extras carpet:2". */
export function selecaoEmTexto(sel: unknown): string {
  if (!sel || typeof sel !== "object") return "·";
  const s = sel as Record<string, unknown>;
  const partes: string[] = [];
  if (Array.isArray(s.services)) partes.push(`services ${(s.services as unknown[]).map(String).join(", ")}`);
  const clean = (s.clean ?? {}) as Record<string, unknown>;
  if (clean.kind) partes.push(`kind ${String(clean.kind)}`);
  if (s.size != null && s.size !== "") partes.push(`size ${String(s.size)}`);
  if (Number(s.bathrooms) > 1) partes.push(`bathrooms ${String(s.bathrooms)}`);
  const extras = clean.extras && typeof clean.extras === "object" ? Object.entries(clean.extras as Record<string, unknown>).filter(([, v]) => Boolean(v)) : [];
  if (extras.length) partes.push(`extras ${extras.map(([k, v]) => (Number(v) > 1 ? `${k}:${v}` : k)).join(", ")}`);
  const fix = (s.fix ?? {}) as Record<string, unknown>;
  if (fix.package) partes.push(`handyman ${String(fix.package)}`);
  const cert = (s.cert ?? {}) as Record<string, unknown>;
  if (Array.isArray(cert.items) && cert.items.length) partes.push(`certificates ${(cert.items as unknown[]).map(String).join(", ")}`);
  const paint = (s.paint ?? {}) as Record<string, unknown>;
  if (paint.option) partes.push(`paint ${String(paint.option)}${paint.rooms ? ` ${String(paint.rooms)} rooms` : ""}`);
  return partes.join(" · ") || "·";
}

function origemEmTexto(fonte: unknown): string {
  if (!fonte || typeof fonte !== "object") return "direct";
  const f = Object.entries(fonte as Record<string, unknown>).filter(([, v]) => v != null && String(v).trim() !== "");
  return f.length ? f.map(([k, v]) => `${k}=${String(v).slice(0, 120)}`).join(" · ") : "direct";
}

/**
 * A nota interna de abertura: tudo o que o time precisa para ligar ou responder
 * sem abrir o OS. Em inglês, como todo conteúdo do OS, e sem travessão.
 */
export function notaDeAbertura(l: LeadParaZendesk): string {
  const detalhes = Array.isArray((l.selection as { details?: unknown } | null)?.details)
    ? ((l.selection as { details: unknown[] }).details).map(String).join(" · ")
    : "";
  const passo = Number(l.step_reached) || 1;
  return [
    "Booking started on getfixfy.com and not paid. The OS runs the recovery sequence from here.",
    "",
    `Service: ${String(l.service_label || "booking")}`,
    `Price: ${libras(l.price)}`,
    ...(detalhes ? [`Details: ${detalhes}`] : []),
    `Selection: ${selecaoEmTexto(l.selection)}`,
    `Stopped at: step ${passo} of 4 (${PASSOS_DO_SITE[passo - 1] ?? "booking"})`,
    `Postcode: ${String(l.postcode || "·")}`,
    `Email: ${String(l.email || "·")}`,
    `Phone: ${String(l.phone || "·")}`,
    `Resume link: ${String(l.resume_url || "·")}`,
    `Source: ${origemEmTexto(l.source)}`,
    `Lead in the OS: ${appBaseUrl()}/website-leads`,
    "",
    "Plan: email 1 now, email 2 the next morning at 09:30, email 3 with 10% off the morning after, and a WhatsApp at 15:00 that day when there is a phone.",
    "Replies to these emails land in this ticket. Any reply from the customer stops the automatic touches.",
  ].join("\n");
}

/** O endereço do ticket para o reply-to. Null quando falta o encoded id ou o subdomínio. */
export function enderecoDoTicket(encodedId: string | null | undefined, subdominio = process.env.ZENDESK_SUBDOMAIN?.trim()): string | null {
  const id = String(encodedId ?? "").trim().toUpperCase();
  if (!subdominio || !/^[A-Z0-9]{4,12}-[A-Z0-9]{3,12}$/.test(id)) return null;
  return `support+id${id}@${subdominio}.zendesk.com`;
}

/**
 * O reply-to dos e-mails de retomada: o endereço do ticket do lead, para a
 * resposta cair nele mesmo que o cliente apague a citação. Sem ticket, o de
 * sempre (RESEND_MARKETING_REPLY_TO ou hello@).
 *
 * RESERVA_ABANDONADA_REPLY_TO com um endereço fixa esse endereço (por exemplo
 * `hello@getfixfy.com`, o jeito antigo); o encoded id escondido no corpo
 * continua levando a resposta ao ticket.
 */
export function responderPara(encodedId: string | null | undefined, env: Record<string, string | undefined> = process.env): string {
  const escolha = env.RESERVA_ABANDONADA_REPLY_TO?.trim();
  const padrao = env.RESEND_MARKETING_REPLY_TO?.trim() || "hello@getfixfy.com";
  if (escolha && escolha.toLowerCase() !== "ticket") return escolha;
  return enderecoDoTicket(encodedId, env.ZENDESK_SUBDOMAIN?.trim()) ?? padrao;
}

// ---------------------------------------------------------------- respostas (puro)

export type ComentarioZendesk = {
  id: number;
  author_id: number;
  public: boolean;
  created_at: string;
  body?: string | null;
  plain_body?: string | null;
};
export type UsuarioZendesk = { id: number; role?: string | null };

export type Resposta = {
  /** cliente = o lead escreveu; equipe = alguém do time respondeu em público no ticket do lead. */
  tipo: "cliente" | "equipe";
  quando: string;
  ticketId: number;
  /** "Stop promotions", STOP, unsubscribe: a pessoa pediu para sair. */
  pedidoDeSaida: boolean;
};

/**
 * A primeira resposta depois de `desde` num ticket.
 *
 * No ticket do lead: comentário de end-user é o cliente; comentário PÚBLICO de
 * agente é o time conversando com ele (as nossas notas são internas). Em outro
 * ticket (novo por e-mail, WhatsApp), só vale o que o próprio solicitante
 * escreveu: nota de agente num ticket de job não quer dizer nada sobre o lead.
 */
export function respostaNosComentarios(
  comentarios: ComentarioZendesk[],
  usuarios: UsuarioZendesk[],
  desde: Date,
  ticketId: number,
  opcoes: { soDoSolicitante?: number | null } = {},
): Resposta | null {
  const papel = new Map(usuarios.map((u) => [u.id, String(u.role ?? "")]));
  const depois = comentarios
    .filter((c) => Date.parse(c.created_at) > desde.getTime())
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

  const doCliente = depois.find((c) =>
    opcoes.soDoSolicitante != null ? c.author_id === opcoes.soDoSolicitante : papel.get(c.author_id) === "end-user",
  );
  if (doCliente) {
    return { tipo: "cliente", quando: doCliente.created_at, ticketId, pedidoDeSaida: ehPedidoDeSaida(doCliente.plain_body ?? doCliente.body) };
  }
  if (opcoes.soDoSolicitante != null) return null;
  const doTime = depois.find((c) => c.public && ["agent", "admin"].includes(papel.get(c.author_id) ?? ""));
  return doTime ? { tipo: "equipe", quando: doTime.created_at, ticketId, pedidoDeSaida: false } : null;
}

// ---------------------------------------------------------------- API

// Env lido na hora da chamada (script importa depois de carregar o .env.local).
const base = () => `https://${process.env.ZENDESK_SUBDOMAIN?.trim()}.zendesk.com/api/v2`;
const autorizacao = () =>
  "Basic " +
  Buffer.from(`${process.env.ZENDESK_EMAIL?.trim() || process.env.ZENDESK_API_EMAIL?.trim()}/token:${process.env.ZENDESK_API_TOKEN?.trim()}`).toString("base64");

class ErroZendesk extends Error {
  constructor(readonly status: number, caminho: string) {
    super(`Zendesk ${status} em ${caminho.split("?")[0]}`);
  }
}

async function zd<T>(caminho: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${base()}/${caminho}`, {
    ...init,
    headers: { Authorization: autorizacao(), "Content-Type": "application/json", Accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new ErroZendesk(r.status, caminho);
  return (await r.json()) as T;
}

/** Busca do Zendesk aceita data e hora ISO, mas sem milissegundo. */
const semMs = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

export type TicketDaBusca = {
  id: number;
  requester_id: number;
  status: string;
  tags?: string[];
  encoded_id?: string;
  via?: { channel?: string };
  created_at?: string;
  updated_at?: string;
};

export async function buscarTickets(consulta: string, limite = 30): Promise<TicketDaBusca[]> {
  const r = await zd<{ results?: TicketDaBusca[] }>(
    `search.json?query=${encodeURIComponent(consulta)}&sort_by=updated_at&sort_order=desc&per_page=${Math.min(limite, 100)}`,
  );
  return (r.results ?? []).filter((t) => typeof t.id === "number").slice(0, limite);
}

export async function lerTicket(id: number | string): Promise<{ id: number; status: string; encodedId: string | null; requesterId: number } | null> {
  try {
    const r = await zd<{ ticket?: { id: number; status: string; encoded_id?: string; requester_id: number } }>(`tickets/${encodeURIComponent(String(id))}.json`);
    if (!r.ticket) return null;
    return { id: r.ticket.id, status: r.ticket.status, encodedId: r.ticket.encoded_id ?? null, requesterId: r.ticket.requester_id };
  } catch (err) {
    if (err instanceof ErroZendesk && err.status === 404) return null;
    throw err;
  }
}

/** A primeira resposta depois de `desde` num ticket (ver `respostaNosComentarios`). */
export async function respostaNoTicket(ticketId: number, desde: Date, opcoes: { soDoSolicitante?: number | null } = {}): Promise<Resposta | null> {
  const r = await zd<{ comments?: ComentarioZendesk[]; users?: UsuarioZendesk[] }>(
    `tickets/${ticketId}/comments.json?include=users&sort_order=desc&per_page=50`,
  );
  return respostaNosComentarios(r.comments ?? [], r.users ?? [], desde, ticketId, opcoes);
}

/**
 * Procura resposta do lead depois de `desde`: no ticket dele, em ticket de que
 * ele é o solicitante (pelo e-mail) e em conversa de WhatsApp do número dele.
 * Devolve a do cliente mais antiga; sem ela, a do time no ticket do lead.
 * Erro de rede sobe: quem chama decide não mandar sem saber.
 */
export async function acharResposta(l: LeadParaZendesk, desde: Date): Promise<Resposta | null> {
  if (!isZendeskConfigured()) return null;
  const achadas: Resposta[] = [];
  const vistos = new Set<number>();

  const doLead = Number(l.zendesk_ticket_id) || null;
  if (doLead) {
    vistos.add(doLead);
    const r = await respostaNoTicket(doLead, desde);
    if (r) achadas.push(r);
  }

  const outros: TicketDaBusca[] = [];
  const email = String(l.email ?? "").trim().toLowerCase();
  if (/^[^\s@"]+@[^\s@"]+\.[^\s@"]+$/.test(email)) {
    outros.push(...(await buscarTickets(`type:ticket requester:${email} updated>${semMs(desde)}`, 5)));
  }
  const fone = toWhatsAppNumber(l.phone);
  if (fone) {
    outros.push(...(await buscarTickets(`type:ticket via:whatsapp requester:+${fone} updated>${semMs(desde)}`, 5)));
  }
  for (const t of outros) {
    if (vistos.has(t.id)) continue;
    vistos.add(t.id);
    const r = await respostaNoTicket(t.id, desde, { soDoSolicitante: t.requester_id });
    if (r) achadas.push(r);
  }

  const cliente = achadas.filter((a) => a.tipo === "cliente").sort((a, b) => Date.parse(a.quando) - Date.parse(b.quando))[0];
  return cliente ?? achadas.find((a) => a.tipo === "equipe") ?? null;
}

/** Tickets de lead que se mexeram desde `desde` (para a varredura de respostas). */
export function ticketsDeLeadMexidos(desde: Date): Promise<TicketDaBusca[]> {
  return buscarTickets(`type:ticket tags:site-lead updated>${semMs(desde)}`, 30);
}

/** Conversas de WhatsApp que se mexeram desde `desde`. */
export function conversasDeWhatsAppMexidas(desde: Date): Promise<TicketDaBusca[]> {
  return buscarTickets(`type:ticket via:whatsapp updated>${semMs(desde)}`, 30);
}

/** O telefone de um usuário do Zendesk, só dígitos com país (447…). */
export async function telefoneDoUsuario(userId: number): Promise<string | null> {
  const r = await zd<{ user?: { phone?: string | null } }>(`users/${userId}.json`);
  return toWhatsAppNumber(r.user?.phone ?? null);
}

// ---------------------------------------------------------------- escrita

/** Nota interna. Nunca derruba quem chama: devolve se gravou. */
export async function anotarNoTicket(ticketId: number | string, texto: string): Promise<boolean> {
  if (!isZendeskConfigured()) return false;
  try {
    await updateTicket({ ticketId, commentBody: texto, publicComment: false });
    return true;
  } catch (err) {
    console.error(`[site-leads] nota no ticket ${ticketId} falhou:`, err instanceof Error ? err.message : err);
    return false;
  }
}

/** O papel de quem tem esse e-mail no Zendesk (em qualquer identidade). Agente ganha de end-user. */
async function papelPorEmail(email: string): Promise<string | null> {
  const r = await zd<{ users?: Array<{ role?: string }> }>(`users/search.json?query=${encodeURIComponent(`email:${email}`)}`);
  const papeis = (r.users ?? []).map((u) => String(u.role ?? ""));
  return papeis.find((p) => p && p !== "end-user") ?? (papeis.length ? "end-user" : null);
}

/**
 * Põe o telefone no perfil do cliente só quando é seguro: se outro usuário do
 * Zendesk já tem esse número (o contato de WhatsApp dele, por exemplo), não
 * mexe, porque identidade de telefone é única e o erro derrubaria o resto.
 */
async function anexarTelefone(userId: number, fone: string): Promise<string> {
  const e164 = `+${fone}`;
  const r = await zd<{ results?: Array<{ id: number }> }>(`search.json?query=${encodeURIComponent(`type:user phone:${e164}`)}`);
  const donos = (r.results ?? []).map((u) => u.id);
  if (donos.includes(userId)) return `Phone ${e164} is already on the customer's profile.`;
  if (donos.length) return `Phone ${e164} belongs to Zendesk user #${donos[0]} (maybe their WhatsApp contact), so it was not added here.`;
  await zd(`users/${userId}/identities.json`, { method: "POST", body: JSON.stringify({ identity: { type: "phone_number", value: e164 } }) });
  return `Phone ${e164} added to the customer's profile.`;
}

export type TicketDoLead = { id: number; encodedId: string | null; criado: boolean; observacoes: string[] };

/**
 * O ticket do lead: o gravado, o que já existe com o external_id dele (volta
 * que morreu entre criar e gravar) ou um novo. Erro sobe: o motor segue sem
 * ticket e tenta de novo no próximo toque.
 */
export async function garantirTicketDoLead(l: LeadParaZendesk): Promise<TicketDoLead | null> {
  if (!isZendeskConfigured()) return null;

  if (l.zendesk_ticket_id) {
    const t = await lerTicket(l.zendesk_ticket_id);
    if (t) return { id: t.id, encodedId: t.encodedId, criado: false, observacoes: [] };
  }

  const externo = `site-lead:${l.id}`;
  const ja = await zd<{ tickets?: Array<{ id: number; encoded_id?: string }> }>(`tickets.json?external_id=${encodeURIComponent(externo)}`);
  const existente = (ja.tickets ?? [])[0];
  if (existente) return { id: existente.id, encodedId: existente.encoded_id ?? null, criado: false, observacoes: [] };

  const criado = await createTicket({
    subject: assuntoDoTicket(l),
    commentBody: notaDeAbertura(l),
    publicComment: false,
    requesterEmail: SOLICITANTE_PROVISORIO.email,
    requesterName: SOLICITANTE_PROVISORIO.nome,
    tags: TAGS_DO_TICKET,
    externalId: externo,
    customFields: ZENDESK_REPLY_STATUS_FIELD_ID > 0 ? [{ id: ZENDESK_REPLY_STATUS_FIELD_ID, value: ZENDESK_REPLY_STATUS_SENT_VALUE }] : undefined,
  });
  if (!criado.ok || !criado.id) throw new Error(`ticket não abriu: ${criado.error ?? criado.status ?? "sem resposta"}`);

  const observacoes: string[] = [];
  const email = String(l.email ?? "").trim().toLowerCase();
  try {
    // Nunca rebaixar um agente: create_or_update com role end-user num e-mail
    // de agente (o dono testando com o próprio) tiraria o acesso dele.
    const papel = email ? await papelPorEmail(email) : null;
    if (!email) {
      observacoes.push("No email on the lead: requester kept as Fixfy Team.");
    } else if (papel && papel !== "end-user") {
      observacoes.push(`Requester kept as Fixfy Team: ${email} is a Zendesk ${papel}.`);
    } else {
      const r = await setTicketRequester({
        ticketId: criado.id,
        email,
        name: String(l.full_name ?? "").trim() || null,
        // O CLIENTE quando existe, senão o próprio lead: nunca a conta
        // ([[requester-do-zendesk-e-do-cliente]]).
        entityId: l.client_id || l.id,
      });
      if (!r.ok || !r.requesterId) {
        observacoes.push(`Requester not changed (${r.error ?? r.status ?? "error"}): replies still thread here by the ticket address.`);
      } else {
        const fone = toWhatsAppNumber(l.phone);
        if (fone) {
          try {
            observacoes.push(await anexarTelefone(r.requesterId, fone));
          } catch (err) {
            observacoes.push(`Phone not added (${err instanceof Error ? err.message : "error"}).`);
          }
        }
      }
    }
  } catch (err) {
    observacoes.push(`Requester not changed (${err instanceof Error ? err.message : "error"}).`);
  }
  return { id: criado.id, encodedId: criado.encodedId ?? null, criado: true, observacoes };
}
