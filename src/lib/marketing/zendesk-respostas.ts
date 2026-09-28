/**
 * As respostas da campanha caem no Zendesk: as do WhatsApp (o app dele está
 * inscrito na WABA) e as do e-mail (o reply-to da campanha é uma caixa do
 * Zendesk). Esta varredura lê os dois e:
 *
 *   "Stop promotions" / STOP   (WhatsApp) tira o número de toda campanha, põe
 *                              a tag `marketing-stop` e resolve o ticket, para
 *                              ninguém do time perder tempo com ele
 *   qualquer outra resposta    carimba `replied_at` no toque (a triagem pula o
 *                              follow-up de WhatsApp de quem respondeu) e deixa
 *                              UMA nota interna no MESMO ticket dizendo o que a
 *                              pessoa recebeu, com a tag `campanha-week10`.
 *                              O ticket fica para o time.
 *
 * WhatsApp: conversas que se mexeram nos últimos `minutos`. E-mail: todo
 * ticket de e-mail criado desde o início da campanha por quem recebeu e-mail
 * dela ANTES de abrir o ticket (quem já falava com a gente antes não conta).
 *
 * A nota e a tag vão no MESMO PUT (`updateTicket`), e a tag é a trava: ticket
 * com `campanha-week10` já foi anotado e a próxima passada não repete. Tags
 * passam sempre pela união (lê, une e grava): gravar a lista direto apagaria
 * as que o Harvey pôs ([[zendesk-tags-duas-armadilhas]]).
 */

import { createServiceClient } from "@/lib/supabase/service";
import { addTicketTags, updateTicket } from "@/lib/zendesk";
import { ehPedidoDeSaida } from "./whatsapp";
import { tirarDaLista } from "./campanha";
import { ticketsDesde, zd, zendeskPronto } from "./zendesk-busca";
import { quandoEmLondres } from "./ritmo";
import { EMAILS, WEEK10, WHATSAPP, linkDaCampanha, type PassoEmail, type PassoWhatsApp } from "./week10-copy";

const TAG = "campanha-week10";

type Ticket = { id: number; requester_id: number; status: string; tags: string[] };
type Comentario = { id: number; author_id: number; body: string; public: boolean; created_at: string };
type Recebido = { passo: string; enviado_em: string };

const ROTULO: Record<PassoEmail | PassoWhatsApp, string> = {
  email_quente: `Email "${EMAILS.email_quente.assunto}"`,
  email_oferta: `Email "${EMAILS.email_oferta.assunto}"`,
  email_lembrete: `Email "${EMAILS.email_lembrete.assunto}"`,
  wa_followup: `WhatsApp follow-up (template ${WHATSAPP.wa_followup.template})`,
  wa_oferta: `WhatsApp offer (template ${WHATSAPP.wa_oferta.template})`,
};

/** A nota interna, para quem atende: o que a pessoa recebeu, quando (Londres), o código e o link. Sem dado pessoal. */
export function notaDaCampanha(recebidos: Recebido[]): string {
  const linhas = recebidos.map((r) => {
    const passo = r.passo as PassoEmail | PassoWhatsApp;
    return `- ${ROTULO[passo] ?? r.passo}, sent ${quandoEmLondres(new Date(r.enviado_em))} (London time). Link: ${linkDaCampanha(passo)}`;
  });
  return [
    `This customer is replying to the ${WEEK10.codigo} campaign.`,
    "",
    "What they received:",
    ...linhas,
    "",
    `Code ${WEEK10.codigo}: 10% off any Fixfy service until Friday 2 October at midnight (London time). The link applies the code at checkout.`,
  ].join("\n");
}

/** O que a pessoa recebeu nesta campanha, do mais velho para o mais novo. */
async function oQueRecebeu(campanha: string, chave: { clientId?: string | null; email?: string | null; phone?: string | null }): Promise<Recebido[]> {
  const sb = createServiceClient();
  let q = sb.from("marketing_queue").select("passo, enviado_em").eq("campanha", campanha).eq("status", "enviado");
  if (chave.clientId) q = q.eq("client_id", chave.clientId);
  else if (chave.email) q = q.eq("email", chave.email);
  else if (chave.phone) q = q.eq("phone", chave.phone);
  else return [];
  const { data, error } = await q.order("enviado_em", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Recebido[]).filter((r) => r.enviado_em);
}

/**
 * Nota + tag num PUT só, uma vez por ticket. Relê as tags antes: a busca do
 * Zendesk devolve o índice, que pode estar alguns minutos atrás do ticket.
 */
async function anotarUmaVez(ticketId: number, recebidos: Recebido[]): Promise<boolean> {
  if (!recebidos.length) return false;
  const { ticket } = await zd<{ ticket?: { tags?: string[] } }>(`tickets/${ticketId}.json`);
  if (ticket?.tags?.includes(TAG)) return false;
  await updateTicket({ ticketId, commentBody: notaDaCampanha(recebidos), publicComment: false, additionalTags: [TAG] });
  return true;
}

export async function varrerRespostasDoZendesk(opcoes: { minutos?: number; aplicar?: boolean; campanha?: string } = {}) {
  if (!zendeskPronto()) return { ok: false, motivo: "Zendesk sem credenciais" };
  const minutos = opcoes.minutos ?? 30;
  const campanha = opcoes.campanha ?? WEEK10.campanha;
  const sb = createServiceClient();
  const res = { tickets: 0, stops: 0, respostas: 0, respostasEmail: 0, notas: 0, semTelefone: 0, detalhes: [] as Array<{ ticket: number; tipo: string }> };

  /* ─── WhatsApp ─── */
  const busca = await zd<{ results: Ticket[] }>(
    `search.json?query=${encodeURIComponent(`type:ticket via:whatsapp updated>${minutos}minutes`)}&sort_by=updated_at&sort_order=desc&per_page=100`,
  );

  for (const t of busca.results ?? []) {
    res.tickets++;
    const { comments } = await zd<{ comments: Comentario[] }>(`tickets/${t.id}/comments.json?sort_order=desc&per_page=5`);
    const dela = (comments ?? []).find((c) => c.author_id === t.requester_id);
    if (!dela) continue;

    const { identities } = await zd<{ identities: Array<{ type: string; value: string }> }>(`users/${t.requester_id}/identities.json`);
    const tel = identities?.find((i) => i.type === "phone_number" || i.type === "whatsapp" || i.type === "messaging")?.value ?? "";
    const phone = tel.replace(/\D/g, "");
    if (!phone) { res.semTelefone++; continue; }

    if (ehPedidoDeSaida(dela.body)) {
      res.stops++;
      res.detalhes.push({ ticket: t.id, tipo: "stop" });
      if (!opcoes.aplicar) continue;
      await tirarDaLista({ phone }, `zendesk_${t.id}`);
      if (!t.tags.includes("marketing-stop")) {
        await addTicketTags(t.id, ["marketing-stop"]);
        await zd(`tickets/${t.id}.json`, { method: "PUT", body: JSON.stringify({ ticket: { status: "solved" } }) });
      }
      continue;
    }

    // Resposta a uma campanha só se houve toque de WhatsApp nos últimos 7 dias para esse número.
    const { data: toque } = await sb
      .from("marketing_touches")
      .select("id, client_id, replied_at")
      .eq("channel", "whatsapp")
      .eq("phone", phone)
      .gte("sent_at", new Date(Date.now() - 7 * 86400000).toISOString())
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!toque) continue;
    res.respostas++;
    res.detalhes.push({ ticket: t.id, tipo: "resposta" });
    if (!opcoes.aplicar) continue;
    if (!toque.replied_at) await sb.from("marketing_touches").update({ replied_at: dela.created_at }).eq("id", toque.id);
    if (!t.tags.includes(TAG) && (await anotarUmaVez(t.id, await oQueRecebeu(campanha, { clientId: toque.client_id, phone })))) res.notas++;
  }

  /* ─── E-mail ─── */
  const deEmail = (await ticketsDesde(new Date(WEEK10.inicio), { via: "email" })).filter((t) => t.email && !t.tags.includes(TAG));
  const enderecos = [...new Set(deEmail.map((t) => t.email as string))];
  // Quem recebeu e-mail da campanha, por endereço: o primeiro envio decide se o ticket veio depois.
  const primeiroEnvio = new Map<string, { enviadoEm: number; clientId: string | null }>();
  for (let i = 0; i < enderecos.length; i += 50) {
    const { data, error } = await sb
      .from("marketing_queue")
      .select("email, client_id, enviado_em")
      .eq("campanha", campanha)
      .eq("canal", "email")
      .eq("status", "enviado")
      .in("email", enderecos.slice(i, i + 50));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const quando = Date.parse(String(r.enviado_em));
      const atual = primeiroEnvio.get(r.email as string);
      if (!atual || quando < atual.enviadoEm) primeiroEnvio.set(r.email as string, { enviadoEm: quando, clientId: (r.client_id as string | null) ?? null });
    }
  }

  for (const t of deEmail) {
    const email = t.email as string;
    const envio = primeiroEnvio.get(email);
    if (!envio || Date.parse(t.criadoEm) <= envio.enviadoEm) continue;
    res.respostasEmail++;
    res.detalhes.push({ ticket: t.id, tipo: "resposta_email" });
    if (!opcoes.aplicar) continue;

    // O carimbo vem antes da nota: se o Zendesk falhar no PUT, a triagem já sabe que ela respondeu.
    const { data: toque } = await sb
      .from("marketing_touches")
      .select("id, replied_at")
      .eq("channel", "email")
      .eq("email", email)
      .like("campaign", `${campanha}:%`)
      .lte("sent_at", t.criadoEm)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (toque && !toque.replied_at) await sb.from("marketing_touches").update({ replied_at: t.criadoEm }).eq("id", toque.id);

    if (await anotarUmaVez(t.id, await oQueRecebeu(campanha, { clientId: envio.clientId, email }))) res.notas++;
  }

  return { ok: true, ...res };
}
