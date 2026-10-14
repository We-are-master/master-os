/**
 * Manda o e-mail do OS ao cliente DENTRO do ticket do pedido, em vez de abrir
 * um ticket novo (ou de sair pela Resend com cópia para o support@, que o
 * Zendesk transforma em ticket: #51315 e #51318 de 13/10/2026).
 *
 * Lança quando o Zendesk recusa, para quem chama decidir (as rotas devolvem
 * erro como já faziam no caminho do Zendesk).
 */

import { createSideConversation, getTicketRequester, sendCustomerCommentWithAttachments, updateTicket, uploadAttachment, zendeskApi } from "@/lib/zendesk";
import { modoDeEntrega, type ModoDeEntrega, type OrigemDoTicket } from "./escolha";

export type EmailNoTicket = {
  ticket: { id: number; origem: OrigemDoTicket; canal: string | null };
  para: { email: string; nome?: string | null };
  /** Cópias (o financeiro da conta). No comentário público viram CC do ticket. */
  cc?: string[];
  assunto: string;
  html: string;
  anexos?: Array<{ filename: string; content: Buffer; contentType?: string }>;
  customStatusId?: number;
};

export type EntregaNoTicket = { modo: ModoDeEntrega; ticketId: number; conversaLateralId?: string };

export async function entregarEmailNoTicket(e: EmailNoTicket): Promise<EntregaNoTicket> {
  const ticketId = e.ticket.id;
  const solicitante = await getTicketRequester(ticketId);
  const modo = modoDeEntrega({ canal: solicitante.channel ?? e.ticket.canal, solicitante: solicitante.requesterEmail, para: e.para.email });
  if (modo === "comentario_publico") {
    if (e.cc?.length) {
      await zendeskApi(`tickets/${ticketId}.json`, { method: "PUT", body: { ticket: { email_ccs: e.cc.map((x) => ({ user_email: x, action: "put" })) } } }).catch((err) =>
        console.warn("[um-ticket] cc:", err instanceof Error ? err.message : err),
      );
    }
    await sendCustomerCommentWithAttachments({ ticketId, htmlBody: e.html, attachments: e.anexos?.length ? e.anexos : undefined, customStatusId: e.customStatusId });
    return { modo, ticketId };
  }

  // Ticket do WhatsApp: o e-mail sai como conversa lateral do próprio ticket; a resposta do cliente volta para ela.
  const tokens: string[] = [];
  for (const a of e.anexos ?? []) tokens.push(await uploadAttachment(a.content, a.filename, a.contentType ?? "application/octet-stream"));
  const r = await createSideConversation({ ticketId, toEmail: e.para.email, toName: e.para.nome ?? null, subject: e.assunto, htmlBody: e.html, attachmentIds: tokens });
  if (!r.ok) throw new Error(`side conversation: ${r.error ?? r.status}`);
  // O e-mail já saiu: a nota é registro, e falhar nela não pode fazer quem chama mandar de novo.
  await updateTicket({
    ticketId,
    customStatusId: e.customStatusId,
    commentBody: `📧 Email "${e.assunto}" sent to ${e.para.email} as a side conversation of this ticket${tokens.length ? ` (${tokens.length} attachment${tokens.length > 1 ? "s" : ""})` : ""}. The customer's reply lands in that side conversation.${e.cc?.length ? ` Not copied to: ${e.cc.join(", ")}.` : ""}`,
    publicComment: false,
  }).catch((err) => console.warn("[um-ticket] nota da conversa lateral:", err instanceof Error ? err.message : err));
  return { modo, ticketId, conversaLateralId: r.id };
}
