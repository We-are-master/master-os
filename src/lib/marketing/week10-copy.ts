/**
 * A copy da campanha WEEK10 (24 a 27/09/2026), escrita pelo GPT-5.5 a partir
 * do brief e conferida por `scripts/marketing-copy-gpt.mts` contra a tabela de
 * preços, a vitrine de 6 serviços e os cupons. Deck de revisão em
 * `.copy-deck/deck.html`.
 *
 * O nome da pessoa entra pelo layout ("Hi Sarah") no e-mail e pela variável
 * {{1}} no WhatsApp; {{2}} é o código. O corpo do WhatsApp aqui é o que foi
 * SUBMETIDO à Meta: mudar este texto não muda o template aprovado, é preciso
 * submeter um template novo com outro nome.
 */

import type { Bloco } from "@/lib/emails/campanha-layout";

export const WEEK10 = {
  campanha: "week10",
  codigo: "WEEK10",
  /** Sexta 02/10/2026 23:59:59 em Londres (BST). Estendido pelo dono em 24/09 (era domingo 27/09). */
  expiraEm: "2026-10-02T22:59:59Z",
  site: "https://www.getfixfy.com/",
} as const;

export type EmailDaCampanha = {
  assunto: string;
  preheader: string;
  etiqueta: string;
  titulo: string;
  blocos: Bloco[];
  cta: string;
};

export type PassoEmail = "email_quente" | "email_oferta" | "email_lembrete";
export type PassoWhatsApp = "wa_followup" | "wa_oferta";

export const EMAILS: Record<PassoEmail, EmailDaCampanha> = {
  email_quente: {
    "assunto": "Fixed-price cleaning in London is here",
    "preheader": "10% off with WEEK10 until Friday 2 October at midnight.",
    "etiqueta": "New prices",
    "titulo": "A quick thank you",
    "blocos": [
      {
        "tipo": "texto",
        "html": "You got in touch with Fixfy before, so I wanted to tell you first.<br><br>We have launched fixed-price cleaning in London. You see the price before you book. It stays fixed on the day."
      },
      {
        "tipo": "texto",
        "html": "To say thank you, use <strong>WEEK10</strong> for <strong>10% off any Fixfy service</strong> until <strong>Friday 2 October at midnight</strong>."
      },
      {
        "tipo": "lista",
        "titulo": "Popular fixed prices",
        "itens": [
          "End of tenancy cleaning from £200, with oven included",
          "Deep cleaning from £174",
          "After builders cleaning from £204",
          "Repairs from £180, painting from £215, certificates from £79"
        ]
      },
      {
        "tipo": "texto",
        "html": "Prices include VAT. Products and equipment are included for cleaning. Every pro is vetted and insured.<br><br>You can book online in about 2 minutes. I may also send a quick WhatsApp later, so the code is easy to find."
      }
    ],
    "cta": "Book with WEEK10"
  },
  email_oferta: {
    "assunto": "10% off Fixfy until Friday 2 October",
    "preheader": "Use WEEK10 by midnight Friday 2 October. Fixed prices, VAT included.",
    "etiqueta": "10% off",
    "titulo": "10% off this week",
    "blocos": [
      {
        "tipo": "texto",
        "html": "<strong>Get 10% off any Fixfy service with code WEEK10 until Friday 2 October at midnight.</strong> Use it on end of tenancy cleaning, deep cleaning, after builders cleaning, repairs, painting or certificates. Book online at getfixfy.com in about 2 minutes and see the price before you book."
      },
      {
        "tipo": "lista",
        "titulo": "Headline prices before 10% off",
        "itens": [
          "End of tenancy cleaning from £200, oven included",
          "Repairs half day, 3.5 hours, £180",
          "Gas Safety Certificate, CP12, £79"
        ]
      },
      {
        "tipo": "texto",
        "html": "Prices include VAT. The price is fixed and never goes up on the day. Every pro is vetted and insured. For cleaning services, if anything is missed, we offer a free re-clean within 7 days."
      }
    ],
    "cta": "Book with WEEK10"
  },
  email_lembrete: {
    "assunto": "WEEK10 ends tomorrow",
    "preheader": "Use code WEEK10 by Friday midnight. Fixed London prices, VAT included.",
    "etiqueta": "Reminder",
    "titulo": "Last chance for WEEK10",
    "blocos": [
      {
        "tipo": "texto",
        "html": "Just a quick reminder. Your <strong>10% code WEEK10</strong> ends tomorrow, Friday, at midnight."
      },
      {
        "tipo": "lista",
        "titulo": "A few fixed prices before the code",
        "itens": [
          "End of tenancy cleaning, studio: £200, oven included",
          "Deep cleaning, studio: £174",
          "Gas Safety Certificate CP12: £79"
        ]
      },
      {
        "tipo": "texto",
        "html": "Book online in about 2 minutes. You see the price before booking, it never goes up on the day, and you can cancel free up to 48 hours before."
      }
    ],
    "cta": "Book online"
  },
};

export const WHATSAPP: Record<PassoWhatsApp, { template: string; corpo: string; botao: string }> = {
  wa_followup: { template: "fixfy_week10_followup_v2", corpo: "Hi {{1}}, we sent you a quick email earlier, so just a small follow-up here.\n\nIf a clean is still on your list, you can get 10% off with code {{2}} until Friday 2 October at midnight.\n\nEnd of tenancy cleaning starts from £200. Deep cleaning starts from £174. Prices include VAT, and the price is fixed before you book.\n\nYou can reply here with any question.", botao: "Book online" },
  wa_oferta: { template: "fixfy_week10_offer_v2", corpo: "Hi {{1}}, thanks for asking Fixfy for a price earlier this year.\n\nIf you still need fixed-price cleaning across London, prices start from:\nEnd of tenancy £200\nDeep clean £174\nAfter builders £204\n\nUse code {{2}} for 10% off until Friday 2 October at midnight.\n\nPrices include VAT, products and equipment. The price is fixed and will not go up on the day.\n\nReply here with any question, or tap below to book.", botao: "Book online" },
};

/** O link de cada peça, com o código (o site aplica sozinho) e a origem. */
export function linkDaCampanha(passo: PassoEmail | PassoWhatsApp): string {
  const canal = passo.startsWith("wa_") ? "whatsapp" : "email";
  const q = new URLSearchParams({ promo: WEEK10.codigo, utm_source: canal, utm_medium: "campaign", utm_campaign: `week10_${passo}` });
  return `${WEEK10.site}?${q.toString()}`;
}
