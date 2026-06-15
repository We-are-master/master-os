import { FIXFY_WHITE_LOGO_URL } from "@/lib/client-catalog-content";

export { FIXFY_WHITE_LOGO_URL };

export const PARTNER_CATALOG_HERO = {
  kicker: "Partner rate guide",
  titleLine1: "Your trade.",
  titleLine2: "Our jobs.",
  titleEmphasis: "Fair pay.",
  subtitle:
    "Standard partner pay rates for trades, certificates and cleaning on the Fixfy network — what you earn on every standard job.",
} as const;

export const PARTNER_CATALOG_ABOUT = {
  kicker: "About Fixfy Partners",
  title: "Steady work, without chasing invoices.",
  lede:
    "Fixfy connects vetted trades with property maintenance jobs across London. You focus on the work — we handle scheduling, customer comms and monthly pay runs.",
  pillars: [
    {
      num: "01",
      title: "Jobs matched to your trade & area",
      body: "Accept work through the Partner app or Trade portal. We only send jobs that match your skills, coverage and availability.",
    },
    {
      num: "02",
      title: "Pay rates agreed before anyone is booked",
      body: "Every service has a standard partner pay rate or fixed per-job amount. The numbers in this guide are what we pay you for standard scope — extras are quoted separately.",
    },
    {
      num: "03",
      title: "Monthly self-bill & fast payment",
      body: "Submit your jobs, upload evidence, and get paid on our monthly run. One statement, clear line items, no chasing property managers.",
    },
  ],
} as const;

export const PARTNER_CATALOG_COMMITMENTS = {
  title: "What you can expect on every job.",
  stats: [
    { value: "48h", label: "typical payment after job completion & approval" },
    { value: "12mo", label: "workmanship guarantee — we re-attend if the customer reports a fault" },
    { value: "£5m", label: "public liability cover on every visit we assign" },
  ],
} as const;

export const PARTNER_CATALOG_PRICING_INTRO = {
  kicker: "Standard partner pay",
  title: "Trades, certificates & cleaning",
  lede:
    "Partner pay rates from the Fixfy catalog. Hourly rates use a one-hour minimum, then 30-minute increments. All amounts include VAT unless stated otherwise.",
} as const;

import type { CatalogRateCardContent } from "@/lib/catalog-rate-card-content-types";

export const PARTNER_CATALOG_CONTENT: CatalogRateCardContent = {
  hero: PARTNER_CATALOG_HERO,
  about: PARTNER_CATALOG_ABOUT,
  commitments: PARTNER_CATALOG_COMMITMENTS,
  pricingIntro: PARTNER_CATALOG_PRICING_INTRO,
  priceLabel: "Pay rate",
  portalLink: "https://partners.getfixfy.com",
  portalLabel: "partners.getfixfy.com",
};
