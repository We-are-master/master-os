/**
 * Os avisos ao cliente que saem como comentário no ticket do Zendesk quando o
 * job ou a cotação chega a um fim:
 *
 *   - Job concluído  (#37)  "Your work is complete", com as fotos anexadas
 *   - Job cancelado  (#38)  "Your booking has been cancelled"
 *   - Cotação fechada (#23) "Your quote is now closed"
 *
 * Copy aprovada em docs/copy/fixfy-client-copy.json (ids 23, 37, 38), na
 * moldura única de `emails/fixfy-shell` com `zendesk: true`.
 *
 * Regras que moram aqui (handoff de 20/10/2026):
 *   - saudação pela RELAÇÃO com a conta (B2B "Hi Acme Lettings team,", B2C
 *     "Hi Sarah,"), nunca o nome da pessoa de contato no B2B;
 *   - o aviso de conclusão não promete fatura (nem toda conta recebe uma) e só
 *     fala de foto quando há foto anexada;
 *   - o cancelamento não fala de reembolso: não há status de pagamento
 *     verificado aqui;
 *   - a cotação fechada não repete a nota de recusa do cliente.
 *
 * O e-mail final com relatório e fatura continua no `final-review-email`.
 */

import { emailFixfy, dataLonga, saudacao, type Publico } from "@/lib/emails/fixfy-shell";
import { passosAte, PASSOS_VISITA } from "@/lib/emails/faixas-do-email";

export type AvisoDoCiclo = {
  assunto: string;
  preheader: string;
  html: string;
  texto: string;
  /** Texto curto para ticket de WhatsApp (sem HTML, sem rodapé de e-mail). */
  whatsapp: string;
};

type Base = {
  publico: Publico;
  /** JOB-9800 / QT-1234, sem "#". */
  reference: string;
  /** Nome do serviço do catálogo ("End of Tenancy Clean"); cai no título do job. */
  service: string;
};

const limpo = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, " ").trim();

/** #37: job concluído (fim do final check). */
export function buildJobCompleted(
  args: Base & { propertyAddress?: string | null; photoCount?: number; /** Dia da conclusão; padrão: hoje (o aviso sai no fim do final check). */ completedOn?: string | Date | null },
): AvisoDoCiclo {
  const ref = limpo(args.reference);
  const servico = limpo(args.service) || "maintenance";
  const endereco = limpo(args.propertyAddress);
  const fotos = Math.max(0, Math.floor(args.photoCount ?? 0));
  const onde = endereco ? ` at ${endereco}` : "";
  const primeiro = fotos > 0
    ? `Your ${servico} work${onde} is complete, and we’ve attached ${fotos === 1 ? "a photo" : "photos"} of the finished work for you to look through.`
    : `Your ${servico} work${onde} is complete.`;
  const assunto = ref ? `Your ${servico} work is complete · ${ref}` : `Your ${servico} work is complete`;
  const preheader = fotos > 0
    ? `${fotos === 1 ? "A photo" : "Photos"} of the finished work ${fotos === 1 ? "is" : "are"} attached for you to review.`
    : `Your ${servico} work is complete.`;
  const paragrafos = [
    primeiro,
    "We hope you’re pleased with the result. If anything needs our attention, just reply and tell us.",
    "Thank you for choosing Fixfy.",
  ];
  const { html, text } = emailFixfy({
    zendesk: true,
    preheader,
    estado: { texto: "Completed", cor: "green" },
    titulo: "That’s another job sorted",
    metricas: [
      { rotulo: "Completed on", valor: dataLonga(args.completedOn ?? new Date()) ?? "" },
      { rotulo: "Service", valor: servico },
    ],
    passos: passosAte(PASSOS_VISITA, 3),
    saudacao: saudacao(args.publico),
    paragrafos,
    linhas: [
      ["Service", servico],
      ["Property", endereco],
      ["Booking", ref],
    ],
  });
  return { assunto, preheader, html, texto: text, whatsapp: [saudacao(args.publico), ...paragrafos].join(" ") };
}

/** #38: job cancelado. `visitDate` é o `scheduled_date` (YYYY-MM-DD) ou um ISO. */
export function buildJobCancelled(args: Base & { propertyAddress?: string | null; visitDate?: string | null }): AvisoDoCiclo {
  const ref = limpo(args.reference);
  const servico = limpo(args.service) || "maintenance";
  const endereco = limpo(args.propertyAddress);
  const dia = dataLonga(args.visitDate ?? null);
  const assunto = ref ? `Your booking has been cancelled · ${ref}` : "Your booking has been cancelled";
  const preheader = `An update on your ${servico} booking.`;
  // cancellation_payment_sentence: omitida. Não há status verificado de pagamento/reembolso neste ponto.
  const paragrafos = [
    dia ? `Your booking for ${servico} on ${dia} has been cancelled.` : `Your booking for ${servico} has been cancelled.`,
    "If you weren’t expecting this, or would like help arranging another visit, please reply and we’ll look into it.",
  ];
  const { html, text } = emailFixfy({
    zendesk: true,
    preheader,
    // Chip vermelho e a data riscada (dono, 23/10/2026).
    estado: { texto: "Cancelled", cor: "red" },
    titulo: "Your booking has been cancelled",
    metricas: [
      { rotulo: "Cancelled visit", valor: dia ?? "", riscado: true },
      { rotulo: "Booking", valor: ref },
    ],
    saudacao: saudacao(args.publico),
    paragrafos,
    linhas: [
      ["Service", servico],
      ["Property", endereco],
      ["Booking", ref],
    ],
  });
  const wa = `${saudacao(args.publico)} Your ${servico} booking${dia ? ` on ${dia}` : ""} has been cancelled. If this wasn’t expected, or you’d like help arranging another visit, please reply.${ref ? ` Reference: ${ref}.` : ""}`;
  return { assunto, preheader, html, texto: text, whatsapp: wa };
}

/** #23: cotação recusada pelo cliente. A nota de recusa NÃO volta para o cliente. */
export function buildQuoteRejected(args: Base): AvisoDoCiclo {
  const ref = limpo(args.reference);
  const servico = limpo(args.service);
  const assunto = ref ? `Your quote has been closed · ${ref}` : "Your quote has been closed";
  const preheader = servico ? `Thank you for letting us know about your ${servico} quote.` : "Thank you for letting us know about your quote.";
  const primeiro = ref && servico
    ? `We’ve recorded that you won’t be going ahead with quote ${ref} for ${servico}.`
    : ref
      ? `We’ve recorded that you won’t be going ahead with quote ${ref}.`
      : servico
        ? `We’ve recorded that you won’t be going ahead with your quote for ${servico}.`
        : "We’ve recorded that you won’t be going ahead with your quote.";
  const paragrafos = [
    primeiro,
    "Thank you for considering Fixfy. If your plans change, just reply and we’ll be happy to look at the work again.",
  ];
  const { html, text } = emailFixfy({
    zendesk: true,
    preheader,
    estado: { texto: "Quote closed", cor: "muted" },
    titulo: "Your quote is now closed",
    saudacao: saudacao(args.publico),
    paragrafos,
    linhas: [
      ["Quote", ref],
      ["Service", servico],
    ],
  });
  return { assunto, preheader, html, texto: text, whatsapp: [saudacao(args.publico), ...paragrafos].join(" ") };
}

/**
 * Quem recebe, pela relação com a conta: organização resolvida (conta B2B que
 * não é a nossa) vira "Hi {empresa} team,"; sem organização é cliente final.
 * `loadAccountOrganizationName` já devolve null para a conta da própria Fixfy.
 */
export function publicoDoAviso(organizacao: string | null | undefined, nomeDoCliente: string | null | undefined): Publico {
  const org = limpo(organizacao);
  if (org) return { tipo: "b2b", empresa: org };
  return { tipo: "b2c", primeiroNome: limpo(nomeDoCliente).split(" ")[0] || null };
}
