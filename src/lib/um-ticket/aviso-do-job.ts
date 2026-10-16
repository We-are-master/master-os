/**
 * Aviso ao cliente DENTRO do ticket do job (dono, 14/10/2026): remarcação e job
 * concluído entram no mesmo ticket em vez de abrir outro ou sair pela Resend.
 *
 *  - ticket de e-mail: comentário público quando o solicitante é quem recebe,
 *    senão conversa lateral (regra do `entregarEmailNoTicket`);
 *  - ticket de WhatsApp: conversa lateral por e-mail; sem e-mail do cliente,
 *    nota interna com o aviso, para a equipe repassar.
 *
 * Lança quando o Zendesk recusa: quem chama decide se cai para a Resend.
 */
import { updateTicket } from "@/lib/zendesk";
import { emailDoCliente } from "./escolha";
import { entregarEmailNoTicket, type EntregaNoTicket } from "./entregar";

export type AvisoNoTicket = {
  ticketId: number;
  para: { email: string | null; nome?: string | null };
  assunto: string;
  html: string;
  anexos?: Array<{ filename: string; content: Buffer; contentType?: string }>;
};

export type EntregaDoAviso = EntregaNoTicket | { modo: "nota_interna"; ticketId: number };

export async function avisarNoTicketDoJob(a: AvisoNoTicket): Promise<EntregaDoAviso> {
  const email = emailDoCliente(a.para.email);
  if (!email) {
    await updateTicket({
      ticketId: a.ticketId,
      htmlBody: `<p><strong>No customer email on file: this was not sent. Please pass it on.</strong></p>${a.html}`,
      publicComment: false,
    });
    return { modo: "nota_interna", ticketId: a.ticketId };
  }
  return entregarEmailNoTicket({
    ticket: { id: a.ticketId, origem: "job", canal: null },
    para: { email, nome: a.para.nome ?? null },
    assunto: a.assunto,
    html: a.html,
    anexos: a.anexos,
    soEmail: true,
  });
}
