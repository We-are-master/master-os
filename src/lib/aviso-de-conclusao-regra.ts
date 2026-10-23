import { canSendClientEmailWithPack, type AccountFinalEmailPolicy } from "@/lib/account-final-email-policy";

/**
 * Quem avisa o cliente que o trabalho acabou (dono, 23/10/2026: um e-mail por acontecimento).
 *
 * Conta que recebe o e-mail final (report e/ou fatura): o e-mail final é o aviso, com o
 * report e o saldo ou o recibo. O aviso automático "work is complete" (status Awaiting
 * payment, zendesk-lifecycle) fica só para a conta que não recebe o final: plataformas
 * com report e fatura desligados.
 */
export function avisoDeConclusaoFicaComOFinal(politica: AccountFinalEmailPolicy): boolean {
  return canSendClientEmailWithPack(politica);
}
