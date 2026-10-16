/**
 * Consentimento do cartão salvo no checkout. Com saldo por cobrar no job, diz quanto e
 * quando; sem saldo, só extra aprovado ou cancelamento tardio.
 */
export function textoDoCartaoSalvo(a: { pct: number; restante: number }): string {
  const agora = a.pct < 100 ? `You pay the ${a.pct}% deposit now.` : "You pay the deposit now.";
  return a.restante > 0.02
    ? `${agora} Your card is saved securely by Stripe and the remaining balance (£${a.restante.toFixed(2)}) is charged automatically when your job is completed and checked. Extra work or materials you approve, or a late-cancellation charge under our booking terms, may also be charged to this card.`
    : `You pay in full now. Your card is saved securely by Stripe and is only charged again for extra work or materials you approve, or a late-cancellation charge under our booking terms.`;
}
