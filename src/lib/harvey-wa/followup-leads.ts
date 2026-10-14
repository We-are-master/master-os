/**
 * Follow-up de quem recebeu o primeiro contato e NUNCA respondeu. Régua do dono
 * em 14/10/2026: agressiva, sem ligação, e o lead fica na view 🎯 Leads o tempo
 * todo. Nada aqui põe 🔴 nem manda para a Action Required: o ticket só sobe
 * quando o cliente responde.
 *
 *   Passo 1  dia 1, na hora      e-mail 1 (o mesmo pedido de fotos do WhatsApp)
 *   Passo 2  dia 1, 18h          template quote_request_checkin + e-mail 2
 *   Passo 3  dia 2, 10h          e-mail 3 (como a gente trabalha)
 *   Passo 4  dia 2, 16h          e-mail 4 (tem vaga esta semana)
 *   Passo 5  dia 3, 10h          e-mail 5 (estamos aqui, os serviços) e solved
 *                                como no response; dali vai para a nutrição.
 *
 * Dois WhatsApps no total (o primeiro contato e o check-in): mais template para
 * quem nunca respondeu derruba a nota do 020 4538 4668, que é o número de todos.
 * Os e-mails saem como comentário público do ticket do lead, então a resposta
 * cai no mesmo ticket. Lead sem e-mail (o requester é a equipe) só leva os
 * WhatsApps e fecha no mesmo dia 3.
 *
 * Lead que já existia quando a régua entrou (14/10/2026) e não tem nenhuma tag
 * lead_fu_*: conta como dia 2 naquele dia (dono). Leva os e-mails 3 e 4 no dia
 * e o último no dia seguinte.
 *
 * Os passos andam em sequência, cada um no seu horário e com 4h de folga do
 * anterior: lead que chega às 19h não leva o check-in às 19h10, leva no dia
 * seguinte às 18h, e o resto anda junto.
 *
 * O lead que veio só com e-mail (tag lead_email_sent) já teve o e-mail 1 na
 * criação do ticket e segue do passo 2, sem o WhatsApp.
 *
 * O estado mora no ticket do lead (tags lead_fu_1..lead_fu_5; lead_checkin_sent
 * vale como passo 2 feito). Respondeu em qualquer momento: no WhatsApp o ticket
 * do lead é juntado no da conversa (fecha); por e-mail o comentário dele aparece
 * no ticket e a varredura para. Só de 8h às 21h de Londres, dentro da janela de
 * envio da tela do Harvey.
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
/** Estágio 🎯 Lead (categoria pending). Só `status: pending` cairia no On Hold padrão, que é a Needs Attention. */
const ESTAGIO_LEAD = 6417913706527;
const WHATSAPP_DA_FIXFY = "020 4538 4668";

export type ResultadoFollowup = { ensaio: boolean; olhados: number; enviados: string[]; fechados: string[]; pulados: string[] };

type Ticket = { id: number; status: string; tags: string[]; created_at?: string; requester_id?: number; subject?: string };
type Comentario = { created_at: string; author_id: number; public: boolean };

// ─── A régua (pura, sem rede) ───────────────────────────────────────────────

type Relogio = { dia: string; hora: number };

function emLondres(d: Date): Relogio {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", hour12: false }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { dia: `${v("year")}-${v("month")}-${v("day")}`, hora: Number(v("hour")) % 24 };
}

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / (24 * H));
}

/** Quantos passos já foram feitos, pelas tags do ticket. */
export function passosFeitos(tags: Iterable<string>, soPorEmail: boolean): number {
  const s = new Set(tags);
  let n = soPorEmail ? 1 : 0;
  if (s.has("lead_checkin_sent")) n = Math.max(n, 2);
  for (let i = 1; i <= 5; i++) if (s.has(`lead_fu_${i}`)) n = Math.max(n, i);
  return n;
}

/**
 * O próximo passo que já pode sair agora, ou null. `primeiro` é o primeiro
 * contato; `ultimo`, quando saiu o passo anterior (o comentário mais novo do ticket).
 */
export function proximoPasso(feitos: number, primeiro: Date, ultimo: Date, agora: Date): number | null {
  const passo = feitos + 1;
  if (passo > 5) return null;
  const a = emLondres(agora);
  const folga = agora.getTime() - ultimo.getTime() >= 4 * H;
  switch (passo) {
    case 1:
      return 1;
    case 2:
      return a.hora >= 18 && folga ? 2 : null;
    case 3:
      return a.hora >= 10 && diasEntre(emLondres(ultimo).dia, a.dia) >= 1 ? 3 : null;
    case 4:
      return a.hora >= 16 && folga ? 4 : null;
    default:
      return a.hora >= 10 && folga && diasEntre(emLondres(primeiro).dia, a.dia) >= 2 ? 5 : null;
  }
}

/** O dia em que esta régua entrou, e a véspera, que vira o "dia 1" dos leads de antes dela. */
const INICIO_DA_REGUA = "2026-10-14";
const VESPERA_DA_REGUA = "2026-10-13";

/** Lead de antes da régua que ainda não recebeu nenhum passo dela. */
export function ehDaReguaAntiga(primeiro: Date, tags: Iterable<string>): boolean {
  const s = [...tags];
  return emLondres(primeiro).dia < INICIO_DA_REGUA && !s.some((t) => /^lead_fu_\d$/.test(t));
}

// ─── Os textos ──────────────────────────────────────────────────────────────

export function emailDoPasso(passo: number, nome: string, servico: string): string {
  const fim = ["", "Thank you,", "Fixfy Team"];
  const corpos: Record<number, string[]> = {
    1: [
      `This is Fixfy. We've just received your Checkatrade request for ${servico}.`,
      "",
      "Could you reply to this email with a few photos of the job? That way we can give you an accurate price with no surprises.",
      "",
      `If it's easier, you can also message us on WhatsApp on ${WHATSAPP_DA_FIXFY}.`,
    ],
    2: [
      `Just checking in on your request for ${servico}.`,
      "",
      "If you reply with a couple of photos, we'll come back with a price first thing tomorrow.",
      "",
      `Prefer to chat? Message us on WhatsApp on ${WHATSAPP_DA_FIXFY}.`,
    ],
    3: [
      `A quick note on how we work, in case it helps with your ${servico} job:`,
      "",
      "· A clear price agreed before any work starts",
      "· No call-out fee",
      "· Vetted, insured professionals",
      "· Every job backed by our workmanship guarantee",
      "",
      "Reply with a photo of the job and we'll price it today.",
    ],
    4: [
      `We still have availability this week for your ${servico} job.`,
      "",
      "If you'd like to go ahead, reply with a photo and your postcode and we'll get you booked in.",
      "",
      "If you've already sorted it, no problem: just let us know and we'll close your request.",
    ],
    5: [
      `We haven't heard back, so we'll close your request for ${servico} for now.`,
      "",
      "If you need anything in the future, we're here. Across London we cover:",
      "",
      "· Handyman jobs, carpentry and furniture assembly",
      "· Plumbing and electrical work",
      "· Painting and decorating",
      "· End of tenancy and deep cleaning",
      "",
      `Just reply to this email or message us on WhatsApp on ${WHATSAPP_DA_FIXFY}.`,
    ],
  };
  return [`Hi ${nome},`, "", ...(corpos[passo] ?? []), ...fim].join("\n");
}

// ─── Zendesk ────────────────────────────────────────────────────────────────

async function ticketDoLead(leadExterno: string): Promise<Ticket | null> {
  const { tickets } = await zendeskApi<{ tickets: Ticket[] }>(`tickets.json?external_id=${encodeURIComponent(externalIdDoLead(leadExterno))}`);
  return tickets?.find((t) => !["solved", "closed"].includes(t.status)) ?? null;
}

async function comentarios(ticket: number): Promise<Comentario[]> {
  const { comments } = await zendeskApi<{ comments?: Comentario[] }>(`tickets/${ticket}/comments.json?sort_order=desc&per_page=30`);
  return comments ?? [];
}

/** O e-mail do requester, se for o cliente (e não o e-mail da equipe que o ticket usa quando o lead veio sem e-mail). */
async function emailDoCliente(t: Ticket): Promise<{ email: string; nome: string | null } | null> {
  if (!t.requester_id) return null;
  const { user } = await zendeskApi<{ user?: { email?: string | null; name?: string | null } }>(`users/${t.requester_id}.json`);
  const email = String(user?.email ?? "").trim().toLowerCase();
  return email && !/@getfixfy\.com$/.test(email) ? { email, nome: user?.name ?? null } : null;
}

async function mandarCheckinNoWhatsApp(telefone: string, nome: string, servico: string, leadExterno: string) {
  await scNotificacao({
    destination: { integrationId: await idDaIntegracaoWhatsApp(), destinationId: telefone },
    author: { role: "appMaker" },
    messageSchema: "whatsapp",
    message: {
      type: "template",
      template: {
        namespace: process.env.HARVEY_WA_TEMPLATE_NAMESPACE?.trim() || "6ce5890e_770a_4be1_91db_7d34bc67e542",
        name: TEMPLATE_CHECKIN,
        language: { policy: "deterministic", code: process.env.HARVEY_WA_LEAD_TEMPLATE_LANG?.trim() || "en_GB" },
        components: [{ type: "body", parameters: [{ type: "text", text: nome }, { type: "text", text: `your ${servico} request` }] }],
      },
    },
    metadata: { origem: "lead_checkin", leadExterno },
  });
}

const PROXIMO: Record<number, string> = {
  1: "Next: WhatsApp check-in and email 2 at 6pm.",
  2: "Next: email 3 tomorrow at 10am.",
  3: "Next: email 4 at 4pm.",
  4: "Next: last email tomorrow at 10am, then solved as no response.",
};

type Lead = { ticket: Ticket; telefone: string | null; nome: string; servico: string; leadExterno: string | null; primeiro: Date; soPorEmail: boolean };

/** Um lead: decide o passo e, com `aplicar`, executa. O ticket nunca sai da view Leads. */
async function seguirLead(l: Lead, out: ResultadoFollowup, aplicar: boolean, agora: Date) {
  const t = l.ticket;
  const tags = new Set(t.tags);
  if (tags.has("lead_no_response")) return;
  const cs = await comentarios(t.id).catch(() => [] as Comentario[]);
  // Respondeu por e-mail: o comentário dele está no ticket. A Action Required cuida dali.
  if (cs.some((c) => c.public && t.requester_id && c.author_id === t.requester_id)) return;
  out.olhados++;
  let feitos = passosFeitos(tags, l.soPorEmail);
  let primeiro = l.primeiro;
  let ultimo = cs[0] ? new Date(cs[0].created_at) : l.primeiro;
  if (ehDaReguaAntiga(l.primeiro, tags)) {
    // Dono, 14/10/2026: o lead antigo entra hoje como dia 2.
    feitos = Math.max(feitos, 2);
    primeiro = ultimo = new Date(`${VESPERA_DA_REGUA}T12:00:00Z`);
  }
  const passo = proximoPasso(feitos, primeiro, ultimo, agora);
  if (!passo) return;
  const quem = `#${t.id} passo ${passo}${l.telefone ? ` ${l.telefone}` : " e-mail"}`;
  if (passo === 5) out.fechados.push(quem);
  else out.enviados.push(quem);
  if (!aplicar) return;

  try {
    const cliente = await emailDoCliente(t).catch(() => null);
    const feito: string[] = [];
    if (passo === 2 && l.telefone && l.leadExterno) {
      await mandarCheckinNoWhatsApp(l.telefone, l.nome, l.servico, l.leadExterno);
      feito.push(`WhatsApp check-in (${TEMPLATE_CHECKIN})`);
    }
    const corpoDoTicket: Record<string, unknown> = {};
    if (cliente) {
      corpoDoTicket.comment = { body: emailDoPasso(passo, l.nome, l.servico), public: true };
      feito.push(`email ${passo} to ${cliente.email}`);
    } else {
      corpoDoTicket.comment = {
        body: `Lead follow-up step ${passo}: ${feito.length ? feito.join(", ") : "nothing to send (no email on this lead)"}. ${passo === 5 ? "" : PROXIMO[passo] ?? ""}`.trim(),
        public: false,
      };
    }
    if (passo === 5) {
      corpoDoTicket.status = "solved";
      corpoDoTicket.custom_fields = [{ id: RESOLUCAO, value: "res_no_response" }];
    } else {
      // A bola está com o cliente: fica no estágio Lead, na view Leads, longe da Action Required.
      corpoDoTicket.custom_status_id = ESTAGIO_LEAD;
      corpoDoTicket.custom_fields = [{ id: ZENDESK_REPLY_STATUS_FIELD_ID, value: "reply_replied" }];
    }
    await zendeskApi(`tickets/${t.id}.json`, { method: "PUT", body: { ticket: corpoDoTicket } });
    if (cliente && feito.length > 1) {
      // Com e-mail, o comentário público é o e-mail; o WhatsApp fica registrado numa nota.
      await zendeskApi(`tickets/${t.id}.json`, { method: "PUT", body: { ticket: { comment: { body: `Lead follow-up step ${passo}: ${feito.join(", ")}. ${PROXIMO[passo] ?? ""}`.trim(), public: false } } } });
    }
    await addTicketTags(t.id, passo === 5 ? [`lead_fu_${passo}`, "lead_no_response"] : [`lead_fu_${passo}`, "lead_gen"]);
    // Ticket da régua antiga: tira a marca de "ligar" para nenhum gatilho mandar de volta ao To Call.
    if (tags.has("lead_call") || tags.has("lead_replied")) {
      await zendeskApi(`tickets/${t.id}/tags.json`, { method: "DELETE", body: { tags: ["lead_call", "lead_replied"] } });
    }
  } catch (e) {
    out.pulados.push(`${quem}: ${e instanceof Error ? e.message.slice(0, 120) : "falhou"}`);
  }
}

export async function varrerFollowupDeLeads(sb: SupabaseClient, { aplicar }: { aplicar: boolean }, agora = new Date()): Promise<ResultadoFollowup> {
  const out: ResultadoFollowup = { ensaio: !aplicar, olhados: 0, enviados: [], fechados: [], pulados: [] };
  if (!janelaAberta(await ajustesDoHarvey(), agora)) return out;
  const hora = emLondres(agora).hora;
  if (hora < 8 || hora >= 21) return out;

  // Leads do WhatsApp (primeiro contato pelo template).
  const { data: leads } = await sb
    .from("harvey_wa_leads")
    .select("telefone, cliente_id, lead_externo, servico, enviado_em, origem")
    .not("lead_externo", "is", null)
    .gte("enviado_em", new Date(agora.getTime() - 8 * 24 * H).toISOString())
    .limit(200);

  for (const l of leads ?? []) {
    if (l.origem === "site") continue;
    // Respondeu? A conversa do WhatsApp tem mensagem dele depois do template.
    const { data: conv } = await sb.from("harvey_wa_conversas").select("cliente_em").eq("phone", l.telefone).maybeSingle();
    if (conv?.cliente_em && new Date(conv.cliente_em as string) > new Date(l.enviado_em as string)) continue;
    const t = await ticketDoLead(l.lead_externo as string).catch(() => null);
    if (!t) continue; // juntado (respondeu) ou já resolvido
    const { data: c } = await sb.from("clients").select("full_name").eq("id", l.cliente_id).maybeSingle();
    await seguirLead(
      {
        ticket: t,
        telefone: l.telefone as string,
        nome: firstName((c?.full_name as string | null) ?? null) ?? "there",
        servico: String(l.servico ?? "your job").trim(),
        leadExterno: l.lead_externo as string,
        primeiro: new Date(l.enviado_em as string),
        soPorEmail: false,
      },
      out,
      aplicar,
      agora,
    );
  }

  // Leads que vieram sem telefone: o primeiro contato já foi o e-mail 1, na criação do ticket.
  const desde = new Date(agora.getTime() - 8 * 24 * H).toISOString().slice(0, 10);
  const q = `type:ticket tags:lead_email_sent status<solved created>${desde}`;
  const { results } = await zendeskApi<{ results?: Ticket[] }>(`search.json?query=${encodeURIComponent(q)}`).catch(() => ({ results: [] as Ticket[] }));
  for (const t of results ?? []) {
    if (!t.created_at) continue;
    const cliente = await emailDoCliente(t).catch(() => null);
    await seguirLead(
      {
        ticket: t,
        telefone: null,
        nome: firstName(cliente?.nome ?? null) ?? "there",
        servico: String(t.subject ?? "").split("·")[1]?.trim().toLowerCase() || "your job",
        leadExterno: null,
        primeiro: new Date(t.created_at),
        soPorEmail: true,
      },
      out,
      aplicar,
      agora,
    );
  }
  return out;
}
