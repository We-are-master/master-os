/**
 * Os três e-mails de quem começou a reservar no site e não pagou.
 *
 *   1  30 minutos depois de parar     "o seu preço está guardado"
 *   2  9h30 do dia seguinte ao 1      "alguma dúvida?", com o que está incluso
 *      (limpeza fala de cômodo e checklist; conserto fala do trabalho feito)
 *   3  9h30 do dia seguinte ao 2      10% com código já aplicado
 *
 * Copy aprovada em 20/10/2026 (docs/copy/fixfy-client-copy.json, ids 43, 44 e
 * 45) na moldura única (`emails/fixfy-shell`) com rodapé de marketing. Assina
 * o Victor, que é o remetente (a resposta continua caindo no ticket do lead).
 *
 * O que a copy nova proíbe e por isso saiu: "nothing gets added at checkout",
 * "no hidden charges", "about a minute", a garantia de 14 dias e o "already
 * applied" (o site ainda não comprova que o `promo=` do link aplica o código).
 * Validade só aparece com o código pessoal (`expiresAt`); o fixo não tem prazo
 * por pessoa e o e-mail não inventa um.
 *
 * Quem decide QUANDO cada um sai é `src/lib/site-leads/agenda.ts`; quem decide
 * SE sai (pagou, descadastrou, respondeu, conversa aberta com o time) é o
 * motor, na hora do envio.
 *
 * `ticketRef` é o encoded id do ticket do lead no Zendesk. Vai escondido no fim
 * do e-mail, entre colchetes, como o Zendesk faz nos e-mails dele: a resposta
 * que cita o e-mail cai no ticket do lead, mesmo enviada para o hello@.
 */

import { dataLonga, emailFixfy, horaCurta, saudacao, type Metrica } from "@/lib/emails/fixfy-shell";

const MOTIVO = "You are receiving this because you started a booking at getfixfy.com.";
const ASSINATURA = "Victor Braz, Operations Director at Fixfy";

export type ReservaAbandonada = {
  firstName?: string | null;
  service: {
    /** "2 bed deep clean", "handyman half day". Vai no meio da frase. */
    name: string;
    /** "a 2 bed deep clean". */
    withArticle: string;
  };
  /** Limpeza ou conserto. A copy de 20/10 é a mesma para os dois; fica para quem chama. */
  kind?: "cleaning" | "trade";
  /** Linhas curtas do cartão da reserva: "2 bedrooms", "Up to 3.5 hours". */
  details?: string[];
  postcode?: string | null;
  /** Em libras, com VAT. 0 = sem preço guardado: a linha some. */
  price: number;
  /** Reabre o mesmo serviço, tamanho e postcode. */
  resumeUrl: string;
  whatsappUrl: string;
  unsubscribeUrl: string;
  /**
   * Só no e-mail 3. Com `expiresAt` é o código ÚNICO da pessoa (48 h, uso
   * único); sem ele é o cupom FIXO da Stripe (COMEBACK10), que não expira por
   * pessoa, então o e-mail não promete prazo (DMCC: prazo falso é prática
   * enganosa).
   */
  promo?: { code: string; percentOff: number; discountedPrice: number; expiresAt?: Date | null };
  /** Não usado desde a moldura única (logo vem do shell). Mantido para quem chama. */
  assetBase?: string;
  /** Encoded id do ticket do lead no Zendesk ("ZRGGKR-JXX2N"). Sem ele, a resposta vira ticket novo. */
  ticketRef?: string | null;
};

export type EmailPronto = { subject: string; preheader: string; html: string; text: string };

export function formatarLibras(v: number): string {
  const inteiro = Math.round(v * 100) % 100 === 0;
  return `£${v.toLocaleString("en-GB", { minimumFractionDigits: inteiro ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** "Thursday 22 October 2026 at 10am (UK time)", no horário de Londres. */
export function formatarValidade(d: Date): string {
  return `${dataLonga(d)} at ${horaCurta(d)} (UK time)`;
}

/** O encoded id do Zendesk só com o formato dele; qualquer outra coisa não entra no e-mail. */
function refDoTicket(ref: string | null | undefined): string | null {
  const r = String(ref ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{4,12}-[A-Z0-9]{3,12}$/.test(r) ? r : null;
}

/**
 * O encoded id escondido (cor do fundo, 1px), como o Zendesk faz: some para
 * quem lê e volta na citação da resposta. Não é `display:none` porque há
 * cliente de e-mail que corta o que está oculto ao citar.
 */
function comRefDoTicket(e: { html: string; text: string }, ref: string | null | undefined): { html: string; text: string } {
  const r = refDoTicket(ref);
  if (!r) return e;
  const span = `<span class="zd_encoded_id" aria-hidden="true" style="color:#F5F5F7; font-size:1px; line-height:1px;">[${r}]</span>`;
  return { html: e.html.replace("</body>", `${span}</body>`), text: `${e.text}\n\n[${r}]` };
}

function primeiroNome(d: ReservaAbandonada): string | null {
  const n = d.firstName?.trim().split(/\s+/)[0];
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : null;
}

function montar(d: ReservaAbandonada, m: {
  subject: string;
  preheader: string;
  estado: string;
  titulo: string;
  paragrafos: string[];
  linhas?: Array<[string, string | null | undefined]>;
  destaque?: { linha1: string; riscado?: string | null } | null;
  /** Só com oferta: código, preço e validade. */
  metricas?: Metrica[] | null;
  cta: string;
}): EmailPronto {
  const e = emailFixfy({
    preheader: m.preheader,
    estado: { texto: m.estado, cor: "orange" },
    titulo: m.titulo,
    destaque: m.destaque ?? null,
    metricas: m.metricas ?? null,
    saudacao: saudacao({ tipo: "b2c", primeiroNome: primeiroNome(d) }),
    paragrafos: m.paragrafos,
    linhas: m.linhas,
    cta: { label: m.cta, url: d.resumeUrl },
    linksSecundarios: [{ label: "Message us on WhatsApp", url: d.whatsappUrl }],
    assinatura: ASSINATURA,
    marketing: { descadastroUrl: d.unsubscribeUrl, motivo: MOTIVO },
  });
  const pronto = comRefDoTicket(e, d.ticketRef);
  return { subject: m.subject, preheader: m.preheader, html: pronto.html, text: pronto.text };
}

const nomeDoServico = (d: ReservaAbandonada) => d.service.name.replace(/\s+/g, " ").trim() || "Fixfy";

// ---------------------------------------------------------------- os três

/** #43: 30 minutos depois de parar. */
export function email1(d: ReservaAbandonada): EmailPronto {
  const servico = nomeDoServico(d);
  return montar(d, {
    subject: "Your Fixfy booking is saved",
    preheader: `Pick up your ${servico} booking where you left off.`,
    estado: "Booking saved",
    titulo: "Ready when you are",
    paragrafos: [
      `Your ${servico} booking details are saved, so you don’t need to start again.`,
      "You can review the details and available appointment times using the button below. Nothing is confirmed until you complete the booking.",
      "If there’s something you’d like to check first, just reply. We’re happy to help.",
    ],
    linhas: [
      ["Service", servico],
      ["Property postcode", d.postcode ? d.postcode.trim().toUpperCase() : null],
      ["Saved price", d.price > 0 ? formatarLibras(d.price) : null],
    ],
    cta: "Continue your booking",
  });
}

/** #44: 9h30 do dia seguinte ao 1. */
export function email2(d: ReservaAbandonada): EmailPronto {
  const servico = nomeDoServico(d);
  return montar(d, {
    subject: "A question about your Fixfy booking?",
    preheader: "We’re happy to help before you decide.",
    estado: "Booking saved",
    titulo: "Let’s clear up any questions",
    paragrafos: [
      `If you paused your ${servico} booking because you wanted to check something first, just ask.`,
      "Whether it’s the work included, access to the property or finding a suitable date, we’re happy to talk it through.",
      "Your saved details are ready whenever you’d like to take another look.",
    ],
    cta: "Review your booking",
  });
}

/** #45: 9h30 do dia seguinte ao 2, com o código de desconto. */
export function email3(d: ReservaAbandonada): EmailPronto {
  if (!d.promo) throw new Error("email3 precisa do código de desconto");
  const servico = nomeDoServico(d);
  const pct = d.promo.percentOff;
  const code = d.promo.code;
  const validade = d.promo.expiresAt ? formatarValidade(d.promo.expiresAt) : null;
  const temPreco = d.price > 0 && d.promo.discountedPrice > 0;
  const original = temPreco ? formatarLibras(d.price) : null;
  const comDesconto = temPreco ? formatarLibras(d.promo.discountedPrice) : null;
  const precoEValidade = [
    temPreco ? `That brings the price from ${original} to ${comDesconto}.` : null,
    validade ? `The offer is valid until ${validade}.` : null,
  ].filter(Boolean).join(" ");
  return montar(d, {
    subject: `${pct}% off your saved Fixfy booking`,
    preheader: `Use ${code} when you return to your ${servico} booking.`,
    estado: `${pct}% off`,
    titulo: "A little help to get it booked",
    destaque: comDesconto ? { linha1: comDesconto, riscado: original } : null,
    metricas: [
      { rotulo: "Code", valor: code, sub: `${pct}% off` },
      { rotulo: "New price", valor: comDesconto ?? "" },
      {
        rotulo: "Valid until",
        valor: d.promo.expiresAt ? dataLonga(d.promo.expiresAt) ?? "" : "",
        sub: d.promo.expiresAt && horaCurta(d.promo.expiresAt) ? `${horaCurta(d.promo.expiresAt)} UK time` : null,
      },
    ],
    paragrafos: [
      `If you’re still considering your ${servico} booking, you can use ${code} for ${pct}% off your eligible booking.`,
      ...(precoEValidade ? [precoEValidade] : []),
      "Follow the link below to review the details and choose from the available appointment times. If you have any questions before confirming, just reply.",
    ],
    linhas: [
      ["Service", servico],
      ["Original price", original],
      ["Discounted price", comDesconto],
      ["Code", code],
      ["Valid until", validade],
    ],
    cta: "Review your discounted booking",
  });
}
