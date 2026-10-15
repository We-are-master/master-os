/**
 * Cobrança de quote enviada: ticket em 🟠 Approval esperando o cliente.
 *
 * Régua do dono (14/10/2026): o Approval é o nosso lugar e não pode virar
 * depósito. Sete dias, três lembretes, e no 7º dia fecha.
 *
 *   dia 1  lembrete 1   (24h depois da quote)
 *   dia 3  lembrete 2   (48h depois do 1º)
 *   dia 5  lembrete 3   (48h depois do 2º, o último, avisa que vamos fechar)
 *   dia 7  fecha        solved, What Happened = no_reply
 *
 * Canal:
 *  - B2C: WhatsApp E e-mail. No WhatsApp, texto livre com a janela de 24h aberta e
 *    o template `quote_request_checkin` com ela fechada. O e-mail vai como
 *    comentário público quando o ticket é de e-mail, ou pelo Resend quando o
 *    ticket é de WhatsApp e o OS tem o e-mail da pessoa.
 *  - B2B (tag `b2b`): só e-mail, comentário público no ticket.
 *
 * Se o cliente responde que não precisa mais ("no longer needed", "found someone",
 * "too expensive"...), o ticket fecha na hora com o motivo e uma resposta curta.
 * Qualquer outra resposta fica com a equipe: o Reply Status vira 🔴 e o ticket
 * sobe para a Action Required, como sempre.
 *
 * Estado nas tags do ticket: `quote_chase_1..3`, `quote_closed_no_reply`,
 * `quote_closed_by_customer`. Só 8h às 20h de Londres.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { comentarioDoLeo, htmlDoLeo, textoDoLeo } from "./email-do-leo";
import { zendeskApi, addTicketTags } from "@/lib/zendesk";
import { firstName } from "@/lib/agent/sales/lead-brief";
import { historico, scApi, scNotificacao } from "./sunshine";
import { idDaIntegracaoWhatsApp } from "./primeiro-contato";

const STATUS_APPROVAL = Number(process.env.ZENDESK_STATUS_APPROVAL?.trim() || "5688280626847");
const VIEW_QUOTING = Number(process.env.ZENDESK_VIEW_QUOTING?.trim() || "5685293799071");
/** Campo "What Happened" do formulário Job. */
const WHAT_HAPPENED = 5687150349343;
const H = 3_600_000;

export type ResultadoQuotes = { ensaio: boolean; olhados: number; enviados: string[]; fechados: string[]; pulados: string[] };

type Ticket = { id: number; subject: string; tags: string[]; custom_status_id?: number; requester_id: number; via?: { channel?: string } };
type Comentario = { public: boolean; author_id: number; created_at: string; body?: string };
type Passo = 1 | 2 | 3 | "fechar";

function horaDeLondres(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }).format(d));
}

/**
 * O próximo passo, contado da ÚLTIMA mensagem nossa (que, depois do 1º lembrete,
 * já é o lembrete anterior): 24h para o 1º, 48h entre os outros. Fecha 48h
 * depois do 3º, que dá o 7º dia desde a quote.
 */
export function proximoPasso(tags: string[], horasDesdeNossa: number): Passo | null {
  if (tags.includes("quote_closed_no_reply") || tags.includes("quote_closed_by_customer")) return null;
  if (tags.includes("quote_chase_3")) return horasDesdeNossa >= 48 ? "fechar" : null;
  if (tags.includes("quote_chase_2")) return horasDesdeNossa >= 48 ? 3 : null;
  if (tags.includes("quote_chase_1")) return horasDesdeNossa >= 48 ? 2 : null;
  return horasDesdeNossa >= 24 ? 1 : null;
}

/** Mantido para quem ainda importa o nome antigo. */
export const estagioDaCobranca = (tags: string[], horas: number) => {
  const p = proximoPasso(tags, horas);
  return p === "fechar" ? null : p;
};

export function ehB2B(t: Pick<Ticket, "tags">): boolean {
  return t.tags.includes("b2b");
}

export function textoDaCobranca(passo: 1 | 2 | 3, nome: string, b2b = false): string {
  // Tom profissional, na voz de quem assina (o Leo), e a frase de fecho em parágrafo próprio: dono, 15/10/2026.
  if (b2b) {
    return {
      1: `Hi ${nome},\n\nI am following up on the quote we sent. Should you wish to proceed, please reply with your preferred date and we will confirm the booking.`,
      2: `Hi ${nome},\n\nFollowing up on our quote. If any part of it needs adjusting, whether scope, timing or access, please let me know and we will issue a revised version the same day.`,
      3: `Hi ${nome},\n\nThis is our final follow-up on this quote. If we do not hear back within the next two days, we will close it on our side.\n\nYou can reopen it at any time by replying to this email.`,
    }[passo];
  }
  return {
    1: `Hi ${nome},\n\nI wanted to follow up on the quote we sent you. If you would like to go ahead, please reply with a date that suits you and we will arrange the booking.\n\nIf you have any questions, I will be happy to help.`,
    2: `Hi ${nome},\n\nFollowing up on our quote. If you would like any changes to the scope or the timing, please let me know and I will send you a revised quote.`,
    3: `Hi ${nome},\n\nThis is my final follow-up regarding our quote. If we do not hear from you within the next two days, we will close it on our side.\n\nYou are welcome to get in touch again at any time.`,
  }[passo];
}

/**
 * Resposta que encerra: o cliente desistiu. Conservador de propósito: na dúvida
 * a resposta fica com a equipe. Devolve o valor do "What Happened".
 */
export function motivoDeDesistencia(texto: string | null | undefined): "booked_elsewhere" | "too_expensive" | "customer_cancelled" | null {
  const t = ` ${String(texto ?? "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ")} `;
  if (/(found|got|booked|went with|going with|chose|hired) (someone|somebody|another|a different|other)|booked elsewhere|someone else (is doing|will do|did)|already (booked|sorted|found)/.test(t)) return "booked_elsewhere";
  if (/too (expensive|much|pricey|high)|out of (my|our) budget|can't afford|cannot afford|over (my|our) budget/.test(t)) return "too_expensive";
  if (/no longer (need|needed|required)|don't need (it|this|the|anymore|any more)|do not need|not needed (anymore|any more)?|not (going|gonna) ahead|won't be going ahead|decided not to|changed (my|our) mind|cancel (it|this|the)|please cancel|no thanks|not interested|not required (anymore|any more)?|we're (all )?sorted|it's (been )?sorted|all sorted now/.test(t)) return "customer_cancelled";
  return null;
}

const RESPOSTA_DE_FECHAMENTO = (nome: string) =>
  `Hi ${nome},\n\nThank you for letting us know. We have closed this quote on our side.\n\nShould anything change, please do not hesitate to get in touch.`;

async function fechar(t: Ticket, motivo: string, tag: string, nota: string) {
  await zendeskApi(`tickets/${t.id}.json`, {
    method: "PUT",
    body: { ticket: { status: "solved", custom_fields: [{ id: WHAT_HAPPENED, value: motivo }], comment: { public: false, body: nota } } },
  });
  await addTicketTags(t.id, [tag]);
}

async function emailDoResend(para: string, assunto: string, texto: string) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Leonardo Piovesan · Fixfy <no-reply@getfixfy.com>", reply_to: "hello@getfixfy.com", to: [para], subject: assunto, text: textoDoLeo(texto), html: htmlDoLeo(texto, "Kind regards,", true) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}`);
}

async function emailDoCliente(sb: SupabaseClient, telefone: string | null | undefined): Promise<string | null> {
  const digitos = String(telefone ?? "").replace(/\D/g, "");
  if (digitos.length < 9) return null;
  const { data } = await sb.from("clients").select("email").is("deleted_at", null).ilike("phone", `%${digitos.slice(-9)}%`).not("email", "is", null).limit(1);
  const e = (data?.[0] as { email?: string } | undefined)?.email?.trim();
  return e && e.includes("@") ? e : null;
}

export async function varrerCobrancaDeQuotes(sb: SupabaseClient, { aplicar }: { aplicar: boolean }, agora = new Date()): Promise<ResultadoQuotes> {
  const out: ResultadoQuotes = { ensaio: !aplicar, olhados: 0, enviados: [], fechados: [], pulados: [] };
  const hora = horaDeLondres(agora);
  if (hora < 8 || hora >= 20) return out;

  const { tickets } = await zendeskApi<{ tickets: Ticket[] }>(`views/${VIEW_QUOTING}/tickets.json?per_page=100`);
  for (const t of tickets ?? []) {
    if (t.custom_status_id !== STATUS_APPROVAL) continue;
    out.olhados++;
    const quem = `#${t.id} ${t.subject.slice(0, 50)}`;
    const b2b = ehB2B(t);
    const ehWhatsApp = !b2b && (t.tags.includes("harvey_wa") || t.via?.channel === "whatsapp");

    const { comments } = await zendeskApi<{ comments: Comentario[] }>(`tickets/${t.id}/comments.json?sort_order=desc&per_page=20`);
    const ultimaPublica = (comments ?? []).filter((c) => c.public)[0];
    if (!ultimaPublica) continue;
    const { user } = await zendeskApi<{ user: { name?: string; phone?: string | null; email?: string | null } }>(`users/${t.requester_id}.json`);
    const nome = firstName(user?.name ?? null) ?? "there";

    // Quem falou por último, e há quanto tempo foi a nossa última mensagem.
    let horasDesdeNossa: number;
    let respostaDoCliente: string | null = null;
    let conversa: string | null = null;
    let janelaAberta = false;
    let voz: string | null = null;
    if (ehWhatsApp) {
      const tel = user?.phone ?? null;
      const { data: c } = tel ? await sb.from("harvey_wa_conversas").select("conversation_id").eq("phone", tel).maybeSingle() : { data: null };
      conversa = (c as { conversation_id?: string } | null)?.conversation_id ?? null;
      if (!conversa) { out.pulados.push(`${quem}: no conversation`); continue; }
      const msgs = await historico(conversa, 30);
      const ultimaMsg = msgs.at(-1);
      if (!ultimaMsg) continue;
      const ultimaDoCliente = [...msgs].reverse().find((m) => m.author.type === "user");
      janelaAberta = !!ultimaDoCliente && agora.getTime() - new Date(ultimaDoCliente.received).getTime() < 23 * H;
      if (ultimaMsg.author.type === "user") {
        respostaDoCliente = ultimaMsg.content.text ?? ultimaMsg.content.payload ?? "";
        horasDesdeNossa = 0;
      } else {
        horasDesdeNossa = (agora.getTime() - new Date(ultimaMsg.received).getTime()) / H;
        voz = ultimaMsg.author.displayName ?? null;
      }
    } else if (ultimaPublica.author_id === t.requester_id) {
      respostaDoCliente = ultimaPublica.body ?? "";
      horasDesdeNossa = 0;
    } else {
      horasDesdeNossa = (agora.getTime() - new Date(ultimaPublica.created_at).getTime()) / H;
    }

    // O cliente respondeu. Se desistiu, fecha agora; se não, é com a equipe.
    if (respostaDoCliente !== null) {
      const motivo = motivoDeDesistencia(respostaDoCliente);
      if (!motivo) continue;
      if (!aplicar) { out.fechados.push(`${quem}: would close (${motivo})`); continue; }
      try {
        const resposta = RESPOSTA_DE_FECHAMENTO(nome);
        if (ehWhatsApp && conversa) {
          await scApi(`/conversations/${conversa}/messages`, { method: "POST", body: { author: { type: "business", displayName: "Fixfy" }, content: { type: "text", text: resposta } } });
        } else {
          await zendeskApi(`tickets/${t.id}.json`, { method: "PUT", body: { ticket: { comment: comentarioDoLeo(resposta) } } });
        }
        await fechar(t, motivo, "quote_closed_by_customer", `Quote closed automatically: the customer said they no longer need it (${motivo}).`);
        out.fechados.push(`${quem}: closed (${motivo})`);
      } catch (e) {
        out.pulados.push(`${quem}: ${e instanceof Error ? e.message.slice(0, 100) : "failed"}`);
      }
      continue;
    }

    const passo = proximoPasso(t.tags, horasDesdeNossa);
    if (!passo) continue;

    if (passo === "fechar") {
      if (!aplicar) { out.fechados.push(`${quem}: would close (no_reply, day 7)`); continue; }
      try {
        await fechar(t, "no_reply", "quote_closed_no_reply", "Quote closed automatically on day 7: three follow-ups and no reply.");
        out.fechados.push(`${quem}: closed (no_reply)`);
      } catch (e) {
        out.pulados.push(`${quem}: ${e instanceof Error ? e.message.slice(0, 100) : "failed"}`);
      }
      continue;
    }

    const texto = textoDaCobranca(passo, nome, b2b);
    const email = b2b ? null : ehWhatsApp ? await emailDoCliente(sb, user?.phone) : null;
    const canais = b2b ? "email" : ehWhatsApp ? `WhatsApp${janelaAberta ? "" : " template"}${email ? " + email" : ""}` : `email${user?.phone ? " + WhatsApp template" : ""}`;
    if (!aplicar) { out.enviados.push(`${quem}: would send chase ${passo} (${canais})`); continue; }

    try {
      if (ehWhatsApp && janelaAberta && conversa) {
        await scApi(`/conversations/${conversa}/messages`, { method: "POST", body: { author: { type: "business", displayName: voz || "Fixfy" }, content: { type: "text", text: texto } } });
      } else if (ehWhatsApp || (!b2b && user?.phone)) {
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
      }
      if (!ehWhatsApp) {
        // Ticket de e-mail (B2B ou B2C): o lembrete vai no próprio ticket, e a resposta cai nele.
        await zendeskApi(`tickets/${t.id}.json`, { method: "PUT", body: { ticket: { comment: comentarioDoLeo(texto) } } });
      } else if (email) {
        await emailDoResend(email, "Your Fixfy quote", texto);
      }
      await zendeskApi(`tickets/${t.id}.json`, {
        method: "PUT",
        body: { ticket: { comment: { public: false, body: `Quote chase ${passo} of 3 sent automatically (${canais}).${passo === 3 ? " If there is no reply in 48h the ticket closes as no reply." : ""}` } } },
      });
      await addTicketTags(t.id, [`quote_chase_${passo}`]);
      out.enviados.push(`${quem}: chase ${passo} (${canais})`);
    } catch (e) {
      out.pulados.push(`${quem}: ${e instanceof Error ? e.message.slice(0, 100) : "failed"}`);
    }
  }
  return out;
}
