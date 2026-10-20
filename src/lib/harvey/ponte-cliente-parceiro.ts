/**
 * A ponte entre cliente e parceiro na cotação (B3, dono 19-20/10/2026: "se for pergunta ele
 * consegue ser autônomo suficiente para fazer as perguntas?").
 *
 *  - pergunta do PARCEIRO (lances-por-email.ts, classe "question") → reescrita para o
 *    cliente e mandada no canal do ticket (WhatsApp com a janela aberta, ou resposta
 *    pública no e-mail); fica registrada como `partner_question`;
 *  - a resposta do CLIENTE a ela volta ao parceiro na side conversation dele
 *    (`devolverRespostasAosParceiros`, a cada ciclo do poll);
 *  - resposta do parceiro à pergunta do cliente (classe "answer") → vai ao cliente na hora.
 * Área "perguntas" da tela de autonomia: on manda, ensaio só escreve a nota, off não faz.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { replyToSideConversation, updateTicket, zendeskApi } from "@/lib/zendesk";
import { autorDoAviso } from "@/lib/zendesk-quoter/aviso-de-cotacao";
import { precisaDeAcao } from "@/lib/fila-de-acao";
import { conferirMensagem } from "@/lib/harvey/conferente";

const JANELA_WA_MS = 23 * 36e5;

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const html = (t: string) => `<p>${esc(t).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;

export type Canal = "whatsapp" | "email";

/**
 * Manda um texto ao cliente do ticket pelo canal certo. WhatsApp só com o Harvey na
 * conversa e a janela de 24h aberta; senão comentário público (e-mail) no ticket, se o
 * ticket é de e-mail. Sem canal: devolve null e quem chama decide.
 */
export async function falarComClienteDoTicket(
  sb: SupabaseClient,
  ticketId: number,
  texto: string,
): Promise<{ via: Canal | null; motivo?: string }> {
  const conferido = conferirMensagem(texto, { publico: "cliente" });
  if (!conferido.ok) return { via: null, motivo: `blocked by the checker: ${conferido.problemas.join("; ")}` };

  const { conversaDoTicket } = await import("@/lib/harvey-wa/controle");
  const conversa = await conversaDoTicket(sb, ticketId).catch(() => null);
  if (conversa) {
    const { historico, enviarTexto, vozDaConversa } = await import("@/lib/harvey-wa/sunshine");
    const msgs = await historico(conversa.conversation_id, 50).catch(() => []);
    const ultima = [...msgs].reverse().find((m) => m.author.type === "user");
    const aberta = !!ultima && Date.now() - Date.parse(ultima.received) < JANELA_WA_MS;
    if (conversa.estado === "harvey" && aberta) {
      await enviarTexto(conversa.conversation_id, conferido.texto, vozDaConversa(msgs));
      return { via: "whatsapp" };
    }
    if (conversa.estado === "equipe") return { via: null, motivo: "the team is talking to the customer on WhatsApp" };
  }
  const { ticket } = await zendeskApi<{ ticket: { via?: { channel?: string } } }>(`tickets/${ticketId}.json`);
  const canal = ticket?.via?.channel ?? "";
  if (/whatsapp|native_messaging|sunshine/i.test(canal)) return { via: null, motivo: "WhatsApp ticket with the 24h window closed" };
  await updateTicket({ ticketId, htmlBody: html(conferido.texto), publicComment: true, authorId: await autorDoAviso() });
  return { via: "email" };
}

/** O cliente escreveu algo no ticket ou no WhatsApp depois de `desde`? Devolve o texto. */
export async function respostaDoClienteDesde(sb: SupabaseClient, ticketId: number, desde: number): Promise<{ texto: string; em: string } | null> {
  const { conversaDoTicket } = await import("@/lib/harvey-wa/controle");
  const conversa = await conversaDoTicket(sb, ticketId).catch(() => null);
  if (conversa) {
    const { historico } = await import("@/lib/harvey-wa/sunshine");
    const msgs = await historico(conversa.conversation_id, 50).catch(() => []);
    const doCliente = msgs.filter((m) => m.author.type === "user" && Date.parse(m.received) > desde);
    const texto = doCliente.map((m) => (m.content as { text?: string } | undefined)?.text ?? "").filter(Boolean).join("\n").trim();
    if (texto) return { texto, em: doCliente.at(-1)!.received };
  }
  const { ticket } = await zendeskApi<{ ticket: { requester_id: number } }>(`tickets/${ticketId}.json`);
  const { comments } = await zendeskApi<{ comments: Array<{ id: number; author_id: number; public: boolean; plain_body?: string; body?: string; created_at: string }> }>(
    `tickets/${ticketId}/comments.json?sort_order=desc&per_page=20`,
  );
  const doCliente = (comments ?? []).filter((c) => c.public && c.author_id === ticket?.requester_id && Date.parse(c.created_at) > desde);
  if (!doCliente.length) return null;
  const { soOqueENovo } = await import("@/lib/zendesk-quoter/sem-citacao");
  const texto = doCliente
    .reverse()
    .map((c) => soOqueENovo(c.plain_body ?? c.body ?? ""))
    .filter(Boolean)
    .join("\n")
    .trim();
  return texto ? { texto, em: doCliente.at(-1)!.created_at } : null;
}

/**
 * Pergunta do parceiro sobre o trabalho: vai ao cliente (modo on) ou vira nota (ensaio).
 * Devolve a linha para a nota interna.
 */
export async function perguntaDoParceiroAoCliente(
  sb: SupabaseClient,
  a: { ticketId: number; quoteRef: string; parceiroNome: string; pergunta: string; modo: "on" | "ensaio" | "off" },
): Promise<{ linha: string; enviada: boolean }> {
  const texto = `Hi, quick question from the professional pricing your job (${a.quoteRef}) so the price is right: ${a.pergunta.trim()} Just reply here and I'll pass it on.`;
  if (a.modo !== "on") {
    await precisaDeAcao(a.ticketId, `${a.parceiroNome} asked a question on ${a.quoteRef}: pass it to the customer`).catch(() => null);
    return { linha: `Partner question (DRY RUN, nothing sent). I would ask the customer: "${texto}"`, enviada: false };
  }
  const r = await falarComClienteDoTicket(sb, a.ticketId, texto);
  if (!r.via) {
    await precisaDeAcao(a.ticketId, `${a.parceiroNome} asked a question on ${a.quoteRef} and I couldn't reach the customer (${r.motivo}): ask them`).catch(() => null);
    return { linha: `Partner question NOT sent to the customer (${r.motivo}). Passed to the team.`, enviada: false };
  }
  // Quem chama marca a mensagem do parceiro como `partner_question`: é ela que a volta procura.
  return {
    linha: `Partner question sent to the customer by ${r.via === "whatsapp" ? "WhatsApp" : "email"}: "${a.pergunta}". Their answer goes back to ${a.parceiroNome} automatically.`,
    enviada: true,
  };
}

/** Resposta do parceiro a uma pergunta do cliente: vai ao cliente na hora (modo on). */
export async function respostaDoParceiroAoCliente(
  sb: SupabaseClient,
  a: { ticketId: number; quoteRef: string; parceiroNome: string; resposta: string; modo: "on" | "ensaio" | "off" },
): Promise<string> {
  const texto = `Good news, the professional has come back on your question about ${a.quoteRef}: ${a.resposta.trim()} Anything else, just ask.`;
  if (a.modo !== "on") {
    await precisaDeAcao(a.ticketId, `${a.parceiroNome} answered on ${a.quoteRef}: pass it to the customer`).catch(() => null);
    return `Partner answer (DRY RUN, nothing sent). I would tell the customer: "${texto}"`;
  }
  const r = await falarComClienteDoTicket(sb, a.ticketId, texto);
  if (!r.via) {
    await precisaDeAcao(a.ticketId, `${a.parceiroNome} answered on ${a.quoteRef} and I couldn't reach the customer (${r.motivo}): pass it on`).catch(() => null);
    return `Partner answer NOT sent to the customer (${r.motivo}). Passed to the team.`;
  }
  return `Partner answer sent to the customer by ${r.via === "whatsapp" ? "WhatsApp" : "email"}.`;
}

/**
 * A cada ciclo: pergunta de parceiro que já foi ao cliente e o cliente respondeu → a
 * resposta vai ao parceiro na side conversation dele. Marca `partner_question_relayed`.
 */
export async function devolverRespostasAosParceiros(
  sb: SupabaseClient,
  postarNotaInterna: (ticketId: number, corpo: string) => Promise<void>,
): Promise<string[]> {
  const out: string[] = [];
  const desde = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data: perguntas, error } = await sb
    .from("quote_partner_messages")
    .select("message_id, quote_id, partner_id, ticket_id, side_conversation_id, body, created_at")
    .eq("kind", "partner_question")
    .gte("created_at", desde)
    .limit(20);
  if (error || !perguntas?.length) return out;
  const ids = perguntas.map((p) => `relayed:${p.message_id}`);
  const { data: feitas } = await sb.from("quote_partner_messages").select("message_id").in("message_id", ids);
  const jaFeitas = new Set((feitas ?? []).map((f) => (f as { message_id: string }).message_id));

  for (const p of perguntas as Array<{ message_id: string; quote_id: string; partner_id: string; ticket_id: number; side_conversation_id: string; body: string; created_at: string }>) {
    if (jaFeitas.has(`relayed:${p.message_id}`)) continue;
    const resposta = await respostaDoClienteDesde(sb, Number(p.ticket_id), Date.parse(p.created_at)).catch(() => null);
    if (!resposta) continue;
    const { data: parceiro } = await sb.from("partners").select("email, job_cc_emails, contact_name, company_name, zendesk_user_id").eq("id", p.partner_id).maybeSingle();
    const email = (parceiro as { email?: string | null } | null)?.email?.trim();
    const { data: q } = await sb.from("quotes").select("reference").eq("id", p.quote_id).maybeSingle();
    const ref = (q as { reference?: string } | null)?.reference ?? "the quote";
    if (!email) continue;
    const corpo = `<p>Hi,</p><p>The customer answered your question on ${esc(ref)}.</p><p><strong>You asked:</strong> ${esc(p.body)}</p><p><strong>They said:</strong> ${esc(resposta.texto.slice(0, 1500))}</p><p>Please send your price when you're ready, just reply to this email.</p><p>Thanks,<br>Fixfy Team</p>`;
    const pc = parceiro as { job_cc_emails?: string[] | null; contact_name?: string | null; company_name?: string | null; zendesk_user_id?: string | number | null };
    const r = await replyToSideConversation({
      ticketId: Number(p.ticket_id),
      sideConversationId: p.side_conversation_id,
      htmlBody: corpo,
      toEmail: email,
      toName: pc.contact_name || pc.company_name || undefined,
      toUserId: pc.zendesk_user_id,
      extraEmails: pc.job_cc_emails ?? [],
    });
    if (!r.ok) {
      out.push(`${ref}: resposta do cliente não foi ao parceiro (${r.error})`);
      continue;
    }
    await sb.from("quote_partner_messages").insert({
      message_id: `relayed:${p.message_id}`,
      quote_id: p.quote_id,
      partner_id: p.partner_id,
      ticket_id: p.ticket_id,
      side_conversation_id: p.side_conversation_id,
      kind: "partner_question_relayed",
      body: resposta.texto.slice(0, 4000),
    });
    await postarNotaInterna(Number(p.ticket_id), `🤖 HARVEY — the customer answered the partner's question on ${ref}. Passed to ${pc.company_name || pc.contact_name || "the partner"}:\n\n"${resposta.texto.slice(0, 800)}"`).catch(() => null);
    out.push(`${ref}: resposta do cliente devolvida ao parceiro`);
  }
  return out;
}
