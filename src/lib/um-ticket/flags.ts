/**
 * Um ticket por pedido (dono, 14/10/2026: "não quero 10 tickets por pedido").
 *
 * Cada comportamento novo tem a sua chave, todas DESLIGADAS por padrão. Com a
 * chave desligada o código faz exatamente o que fazia antes.
 *
 *  - ONE_TICKET_LEADS_VIEW_ON   1. conversa do WhatsApp espelhada no lead ganha a
 *                                  tag `lead_mirrored` (a view 🎯 Leads esconde)
 *  - ONE_TICKET_MERGE_NOTE_ON   2. a nota do merge do lead leva o pedido do Checkatrade
 *  - ONE_TICKET_EMAIL_ON        3. e-mail do OS ao cliente entra no ticket que já existe
 *  - ONE_TICKET_JOB_REUSE_ON    4. job novo usa o ticket do pedido em vez de abrir outro
 *  - ONE_TICKET_CALL_NOTE_ON    5. ligação vira nota no ticket aberto do cliente (script)
 */

function ligado(nome: string): boolean {
  const v = process.env[nome]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

export const umTicketLeadsView = (): boolean => ligado("ONE_TICKET_LEADS_VIEW_ON");
export const umTicketNotaDoMerge = (): boolean => ligado("ONE_TICKET_MERGE_NOTE_ON");
export const umTicketEmail = (): boolean => ligado("ONE_TICKET_EMAIL_ON");
export const umTicketJob = (): boolean => ligado("ONE_TICKET_JOB_REUSE_ON");
export const umTicketLigacao = (): boolean => ligado("ONE_TICKET_CALL_NOTE_ON");

/** Tag da conversa do WhatsApp que tem um lead aberto espelhando (Harvey atendendo). */
export const TAG_CONVERSA_ESPELHADA = "lead_mirrored";
