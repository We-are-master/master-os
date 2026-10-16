/**
 * O renderizador único: peça + contexto vira e-mail.
 *
 * Uma peça é sempre a mesma coisa, venha do nurture de 30 dias ou da agenda da
 * temporada: etiqueta, assunto, título, blocos, botão e, às vezes, cupom. Ter
 * um renderizador só é o que garante que o e-mail do dia 1 e o da semana 30
 * saem com o mesmo logo, o mesmo rodapé e a mesma saída em um clique.
 *
 * O link do botão sai daqui também, sempre etiquetado com `utm_*` e, quando a
 * peça tem cupom, com `promo=CODIGO` na URL. O campo de cupom do site hoje é
 * preenchido à mão no checkout: o parâmetro na URL é para o dia em que o site
 * ler e preencher sozinho, e enquanto isso não atrapalha nada.
 */

import { renderCampanha, type Bloco, type OfertaNoEmail } from "@/lib/emails/campanha-layout";
import { type SequenceContext, ctxStr } from "./types";
import { acharCupom, comoSeLe, validadeCurta } from "@/lib/marketing/cupons";

const SITE = "https://www.getfixfy.com";

export type Peca = {
  key: string;
  etiqueta: string;
  assunto: string;
  preheader: string;
  titulo: string;
  blocos: Bloco[];
  cta: string;
  cupom?: string;
};

/**
 * O link do botão, etiquetado.
 *
 * Sem `utm_*` não dá para separar o que veio do funil do que veio do anúncio, e
 * aí a primeira pergunta do dono, "isto trouxe venda?", não tem resposta.
 */
export function linkDaPeca(ctx: SequenceContext, campanha: string, peca: Peca): string {
  const base = ctxStr(ctx, "bookingUrl") || ctxStr(ctx, "quoteUrl") || `${SITE}/book`;
  const sep = base.includes("?") ? "&" : "?";
  const promo = peca.cupom ? `&promo=${encodeURIComponent(peca.cupom)}` : "";
  return `${base}${sep}utm_source=email&utm_medium=lifecycle&utm_campaign=${encodeURIComponent(campanha)}&utm_content=${encodeURIComponent(peca.key)}${promo}`;
}

/** A oferta pronta para a caixa, ou nada quando a peça não tem cupom. */
export function ofertaDaPeca(peca: Peca): OfertaNoEmail | undefined {
  if (!peca.cupom) return undefined;
  const cupom = acharCupom(peca.cupom);
  // Código tirado da lista: manda a peça sem oferta em vez de prometer um
  // cupom que a Stripe vai recusar na cara do cliente.
  if (!cupom) return undefined;
  return {
    codigo: cupom.codigo,
    valor: comoSeLe(cupom),
    sobre: cupom.nome.replace(/^Fixfy · /, ""),
    validade: validadeCurta(cupom),
  };
}

export function renderPeca(peca: Peca, campanha: string, ctx: SequenceContext): string {
  return renderCampanha({
    preheader: peca.preheader,
    etiqueta: peca.etiqueta,
    titulo: peca.titulo,
    nome: ctxStr(ctx, "name") || undefined,
    blocos: peca.blocos,
    oferta: ofertaDaPeca(peca),
    cta: { texto: peca.cta, url: linkDaPeca(ctx, campanha, peca) },
    unsubscribeUrl: ctxStr(ctx, "unsubscribeUrl") || undefined,
  });
}
