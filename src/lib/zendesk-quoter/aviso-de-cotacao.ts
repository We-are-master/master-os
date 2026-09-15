/**
 * O aviso ao cliente de que a cotação começou.
 *
 * Até aqui o Harvey só escrevia NOTA INTERNA: o preço aparecia para o
 * escritório e o cliente não ouvia nada entre mandar o pedido e receber o
 * orçamento. Nesta janela ele não sabe se alguém leu.
 *
 * O aviso tem duas caras, e qual sai é decidido por UM dado: se sabemos ONDE
 * é o serviço.
 *
 *   tem endereço    os convites saíram, o ticket vai para 🟤 Bidding e a
 *                   mensagem diz que estamos cotando.
 *   não tem         ninguém foi convidado (o casamento de parceiro é por
 *                   postcode), o ticket vai para 🟠 On Hold e a mensagem pede
 *                   o postcode.
 *
 * Em ambos os casos o ticket SAI do Action Required sozinho: comentário
 * público de agente dispara o trigger "🟢 Replied", que marca o reply status
 * como respondido. Quando o cliente responder, o trigger de entrada o traz de
 * volta. Ninguém marca nada à mão.
 *
 * Três travas, e nenhuma é opcional:
 *
 *   1. `HARVEY_QUOTE_ACK=1`. Isto fala com gente de fora. Nasce desligado,
 *      como todo canal de saída desta casa.
 *   2. Organização reconhecida. "Hi Team" é mensagem para a agência. Em
 *      ticket cujo requester é o morador (os que o RPA cria são assim) isso
 *      chega errado na casa de alguém, e já chegou: o aviso público de
 *      cancelamento caiu em dois clientes finais em 12/09/2026.
 *      Ver [[organizacao-pelo-dominio]] e [[requester-do-zendesk-e-do-cliente]].
 *   3. Uma vez por ticket, por cara. A tag é a trava e ela vai no mesmo PUT
 *      do comentário: o ciclo roda de 5 em 5 minutos, e um carimbo que falha
 *      depois de a mensagem sair vira a mesma mensagem outra vez.
 *
 * E uma quarta que é sobre honestidade, não sobre mecânica: com endereço mas
 * ZERO parceiro convidado, ele fica calado. "Estamos trabalhando no seu
 * orçamento" quando ninguém foi perguntado é promessa sem lastro, e acontece
 * de verdade (a QT-2026-1144 tem postcode e zero convites: nenhum handyman
 * cobre CR4).
 */
import { updateTicket } from "@/lib/zendesk";
import { ZD_STATUS_BIDDING, ZD_STATUS_ON_HOLD } from "@/lib/zendesk-statuses";

/** Já dissemos "estamos cotando" neste ticket. */
export const TAG_AVISO_COTANDO = "harvey_ack_quoting";
/** Já pedimos o postcode neste ticket. */
export const TAG_AVISO_POSTCODE = "harvey_ack_postcode";

/**
 * Quem assina o aviso.
 *
 * Não pode ser o Harvey: o assento dele no Zendesk é Contributor, cujo
 * `ticket_comment_access` é `none` — ele não é autor de comentário nenhum. O
 * padrão é o Leonardo, agente pleno, porque quem responde ao aviso cai em quem
 * toca a entrega. O token continua sendo o do Victor, e é ele que o Zendesk
 * registra como updater: é isso que mantém os triggers de agente disparando.
 */
export const AUTOR_DO_AVISO =
  Number(process.env.HARVEY_AVISO_AUTOR_ID?.trim() || "6227542863391");

export type DecisaoDoAviso =
  | { fala: true; cara: "cotando" | "pede_postcode"; tag: string; html: string; status: number; resumo: string }
  | { fala: false; motivo: string };

/**
 * Os dois textos.
 *
 * Sem assinatura: a assinatura do Zendesk entra sozinha no envio, e duas
 * assinaturas numa mensagem é a marca de e-mail automático mal feito.
 */
const CORPO_COTANDO =
  "<p>Hi Team,</p>" +
  "<p>Thanks for sending this over. We're working on a quote now and will come back to you shortly.</p>";

const CORPO_POSTCODE =
  "<p>Hi Team,</p>" +
  "<p>Thanks for sending this over. Before we can price it, could you confirm the property postcode?</p>" +
  "<p>We'll come straight back with the quote as soon as we have it.</p>";

/**
 * Decide, e nada mais. Separada do envio porque é aqui que mora o que pode dar
 * errado com alguém de fora, e teste de decisão não deve precisar de rede.
 */
export function decidirAviso(args: {
  armado: boolean;
  orgReconhecida: boolean;
  temEndereco: boolean;
  convitesEnviados: number;
  tags: string[];
}): DecisaoDoAviso {
  if (!args.armado) return { fala: false, motivo: "HARVEY_QUOTE_ACK is off" };
  if (!args.orgReconhecida) {
    return { fala: false, motivo: "organization not recognised — never speak publicly on a ticket we can't place" };
  }

  if (!args.temEndereco) {
    if (args.tags.includes(TAG_AVISO_POSTCODE)) return { fala: false, motivo: "postcode already asked" };
    return {
      fala: true,
      cara: "pede_postcode",
      tag: TAG_AVISO_POSTCODE,
      html: CORPO_POSTCODE,
      status: ZD_STATUS_ON_HOLD,
      resumo: "asked the customer for the property postcode; ticket parked on hold",
    };
  }

  if (args.convitesEnviados <= 0) {
    return { fala: false, motivo: "no partner was invited — nothing to promise yet" };
  }
  if (args.tags.includes(TAG_AVISO_COTANDO)) return { fala: false, motivo: "already acknowledged" };
  return {
    fala: true,
    cara: "cotando",
    tag: TAG_AVISO_COTANDO,
    html: CORPO_COTANDO,
    status: ZD_STATUS_BIDDING,
    resumo: "told the customer we're working on a quote; ticket moved to Bidding",
  };
}

/**
 * Decide e, se for o caso, fala. Devolve a linha que entra na nota interna,
 * para o escritório ler no mesmo lugar o que o cliente recebeu.
 */
export async function avisarNoTicket(args: {
  ticketId: number;
  tags: string[];
  temEndereco: boolean;
  convitesEnviados: number;
  orgReconhecida: boolean;
  /** `false` é ensaio: decide, escreve na nota, não fala com ninguém. */
  postar: boolean;
}): Promise<string> {
  const d = decidirAviso({
    armado: process.env.HARVEY_QUOTE_ACK === "1",
    orgReconhecida: args.orgReconhecida,
    temEndereco: args.temEndereco,
    convitesEnviados: args.convitesEnviados,
    tags: args.tags,
  });

  if (!d.fala) return `── Customer reply ──\nNot sent: ${d.motivo}.`;

  if (!args.postar) {
    return `── Customer reply (DRY RUN — nothing sent) ──\nWould have ${d.resumo}.`;
  }

  try {
    await updateTicket({
      ticketId: args.ticketId,
      customStatusId: d.status,
      htmlBody: d.html,
      publicComment: true,
      authorId: AUTOR_DO_AVISO,
      additionalTags: [d.tag],
    });
    return `── Customer reply ──\nSent: ${d.resumo}.`;
  } catch (err) {
    // Falhar aqui não pode derrubar a cotação: a nota interna com o preço é o
    // que o escritório precisa, e ela já está pronta.
    console.error(`[quoter] aviso ao cliente falhou no #${args.ticketId}:`, err);
    return `── Customer reply ──\nNOT sent: ${err instanceof Error ? err.message : String(err)}.`;
  }
}
