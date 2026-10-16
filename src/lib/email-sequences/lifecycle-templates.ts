/**
 * Os dez e-mails de quem pediu preço e ainda não fechou.
 *
 * Trinta dias, apertado onde a decisão acontece: hoje, amanhã, depois de
 * amanhã, e depois abrindo. Lead de serviço de casa decide na primeira semana,
 * e quem some no dia 3 já contratou outro.
 *
 * Tom de amigo, nunca de vendedor de porta. Quem recebe isto falou conosco de
 * verdade, tem nome, e pediu um preço. Escrever como disparo é o que faz a
 * pessoa marcar spam, e a marcação não cai sobre a promoção: cai sobre o
 * domínio que também manda confirmação de visita e cobrança.
 *
 * Quem já comprou não vê nada daqui. Esse recebe a agenda da temporada
 * (`agenda.ts`), que é outra conversa e outro ritmo.
 *
 * Copy em inglês, sem travessão, por decisão de marca.
 */

import type { Bloco } from "@/lib/emails/campanha-layout";
import { type Peca, renderPeca } from "./render";
import { pecaDaData } from "./agenda";
import type { SequenceContext } from "./types";

const t = (html: string): Bloco => ({ tipo: "texto", html });
const l = (titulo: string, itens: string[]): Bloco => ({ tipo: "lista", titulo, itens });
const q = (texto: string, autor: string): Bloco => ({ tipo: "citacao", texto, autor });

export const NURTURE: Peca[] = [
  {
    key: "welcome",
    etiqueta: "Your request",
    assunto: "Thanks for asking us. Here is what happens next",
    preheader: "Your request is with us. Here is how we work and what it costs.",
    titulo: "Good to meet you",
    cta: "See my price",
    blocos: [
      t("Thanks for getting in touch. Your request is with our team and we are matching it to vetted London pros right now."),
      l("How Fixfy works", [
        "You see the price before you book, not after the visit",
        "Every pro is checked, insured and rated",
        "You pick the slot that suits you",
        "If anything is not right, we come back",
      ]),
      t("Nothing to sign and nothing to pay while you look. If you would rather talk it through, just reply to this email."),
    ],
  },
  {
    key: "price",
    etiqueta: "How we price",
    assunto: "Your price, with nothing hidden in it",
    preheader: "Fixed price up front. No call-out fee, no doorstep haggling.",
    titulo: "No surprises on the day",
    cta: "Check my price",
    blocos: [
      t("The thing people tell us they hate most is finding out the cost after the work is done. We do it the other way round: you see the full price before anyone knocks on your door."),
      l("Always included", [
        "A fixed price, agreed before we start",
        "No call-out charge",
        "Free rescheduling if your plans move",
        "Insured, checked professionals",
      ]),
      t("If the job turns out to be bigger than described, we tell you and you decide. We never do extra work and invoice you for it afterwards."),
    ],
  },
  {
    key: "whats_included",
    etiqueta: "What you get",
    assunto: "What we actually do when we turn up",
    preheader: "The full checklist, so you know exactly what you are paying for.",
    titulo: "What is in the job",
    cta: "See the full checklist",
    blocos: [
      t("Quick one. People ask what is included, so here it is in plain terms."),
      l("On an end of tenancy or deep clean", [
        "Kitchen deep cleaned, oven included, inside and out",
        "Bathrooms descaled properly, tiles, grout and screens",
        "Inside windows, skirting, doors, handles and switches",
        "Carpets vacuumed, floors washed, cupboards cleared and wiped inside",
      ]),
      t("Handyman, painting, electrics and certificates work the same way: you get the list first, then the price."),
    ],
  },
  {
    key: "social_proof",
    etiqueta: "Near you",
    assunto: "What your neighbours say about us",
    preheader: "Real jobs, real people, a few streets away.",
    titulo: "People near you already booked",
    cta: "Book my slot",
    blocos: [
      t("We work across London every day. This is the kind of note we get afterwards."),
      q("Booked it on a Tuesday, cleaned on the Thursday, landlord signed off the deposit with no deductions. Price was exactly what they quoted.", "Verified Fixfy customer, South London"),
      t("Happy to send you two or three more from your own area if that helps you decide."),
    ],
  },
  {
    key: "deposit",
    etiqueta: "Moving out",
    assunto: "Moving out? This is the part that costs people money",
    preheader: "Most deposit deductions come down to cleaning. It is avoidable.",
    titulo: "Getting your deposit back",
    cta: "Get my move-out price",
    blocos: [
      t("If you are moving, cleaning is the most common reason a deposit gets cut, and the check is not subjective. Agents look at the same things every time."),
      l("What gets checked first", [
        "The oven, inside the door glass and under the trays",
        "Limescale on taps, screens and tiles",
        "Inside cupboards, the fridge and the freezer",
        "Skirting, window frames and extractor fans",
      ]),
      t("Our end of tenancy clean covers all of it, and we come back free if the agent flags something in the first 48 hours."),
    ],
  },
  {
    key: "offer",
    etiqueta: "Offer",
    assunto: "10% off, because you came to us first",
    preheader: "A small thank you for considering us. Yours whenever you are ready.",
    titulo: "A little off your first job",
    cta: "Use my discount",
    cupom: "WELCOME10",
    blocos: [
      t("You came to us and did not book yet, which usually means the timing was not right or you were comparing. Both fair."),
      t("So here is ten percent off your first Fixfy job. It comes off our normal price, not off a marked up one, and it works on any service we do."),
    ],
  },
  {
    key: "easy",
    etiqueta: "Booking",
    assunto: "Sixty seconds and it is booked",
    preheader: "Pick a day, see the price, done. No phone call needed.",
    titulo: "Booking takes a minute",
    cta: "Pick my slot",
    blocos: [
      t("No forms to print and no waiting for a callback. Choose the service, pick a day, see the price, and that is it."),
      l("If you would rather talk", [
        "Reply to this email and we answer, usually the same day",
        "Or call and a person picks up, not a menu",
        "Evening and weekend slots most weeks",
      ]),
    ],
  },
  {
    key: "faq",
    etiqueta: "Straight answers",
    assunto: "The five things people ask us before booking",
    preheader: "Insurance, timing, payment, guarantees. Short answers.",
    titulo: "Asked and answered",
    cta: "Book with confidence",
    blocos: [
      t("These come up every week, so here they are without the sales voice."),
      l("The five", [
        "Are pros insured? Yes, every one, and checked before they take work",
        "When do I pay? When you book, and never more than quoted",
        "Can I move the date? Yes, free of charge",
        "What if it is not right? Tell us within 48 hours and we come back",
        "Do you bring everything? Yes, products and equipment included",
      ]),
    ],
  },
  {
    key: "checkin",
    etiqueta: "Checking in",
    assunto: "Still here whenever you need us",
    preheader: "No pressure. Just a note so you know where to find us.",
    titulo: "No rush from us",
    cta: "See prices",
    blocos: [
      t("It has been a few weeks since you asked us for a price. If you already got it sorted, genuinely glad it is done."),
      t("If not, we are still here and the price has not changed. And if the job turned into something different, reply and tell us what it is now. We quote most things within a day."),
    ],
  },
  {
    key: "breakup",
    etiqueta: "Last one",
    assunto: "Last one from us about this",
    preheader: "We will stop here unless you tell us otherwise.",
    titulo: "We will leave it there",
    cta: "Book when ready",
    blocos: [
      t("This is the last email in this thread. We would rather stop than be the company that keeps emailing about the same thing."),
      t("You will still get our home notes twice a week, which are mostly useful things about looking after a place in London, and the occasional offer worth having. One click at the bottom turns that off too."),
      t("If you need a hand with anything in the home, you know where we are."),
    ],
  },
];

/* ═══════════════════ O que cada sequência renderiza ═══════════════════ */

export function assuntoNurture(i: number): string {
  return NURTURE[i].assunto;
}
export function renderNurture(i: number, ctx: SequenceContext): string {
  return renderPeca(NURTURE[i], "client_lead_nurture", ctx);
}

/**
 * A agenda da temporada, para quem já comprou e para o fogo baixo.
 *
 * A peça vem da DATA, não do contador da pessoa: é o que faz o e-mail de
 * inverno chegar no inverno. Quem recebe duas por semana pega todas; quem
 * recebe uma por semana pega uma sim, uma não, e nenhuma delas depende da
 * anterior para fazer sentido.
 */
export function assuntoAgenda(): string {
  return pecaDaData().assunto;
}
export function renderAgenda(ctx: SequenceContext): string {
  const peca = pecaDaData();
  return renderPeca(peca, "client_season", ctx);
}
