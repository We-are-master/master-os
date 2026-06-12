/** Official white logo for navy backgrounds (emails, rate card cover). */
export const FIXFY_WHITE_LOGO_URL = "https://www.getfixfy.com/brand/fixfy-primary-white.png";

export const CATALOG_HERO = {
  kicker: "Service & price guide",
  titleLine1: "Vetted trades.",
  titleLine2: "Fixed prices.",
  titleEmphasis: "One invoice.",
  subtitle:
    "Maintenance, repairs and cleaning for property portfolios — delivered by our managed workforce at rates agreed up front.",
} as const;

export const CATALOG_ABOUT = {
  kicker: "About Fixfy",
  title: "Your maintenance team, without the headcount.",
  lede:
    "Fixfy supplies the workforce so you don't carry it. You raise the job, we put the right person on site.",
  pillars: [
    {
      num: "01",
      title: "A vetted workforce, on demand",
      body: "Carpenters, electricians, cleaners, gardeners and maintenance pros — background-checked, trade-certified and managed end-to-end by Fixfy.",
    },
    {
      num: "02",
      title: "Prices agreed before anyone is booked",
      body: "Every service has a fixed rate or a fixed per-job price. The number you see is the number on the invoice — no on-site surprises.",
    },
    {
      num: "03",
      title: "One partner, one invoice",
      body: "All trades, all properties, consolidated into a single monthly invoice on your billing terms. Your finance team deals with one supplier, not thirty.",
    },
  ],
} as const;

export const CATALOG_COMMITMENTS = {
  title: "Our commitments, on every single job.",
  stats: [
    { value: "2h", label: "response on emergency call-outs, day or night" },
    { value: "12mo", label: "workmanship guarantee — we re-attend free if it fails" },
    { value: "£5m", label: "public liability insurance covering every visit" },
  ],
} as const;

export const CATALOG_PRICING_INTRO = {
  kicker: "Standard rates",
  title: "Trades, certificates & cleaning",
  lede: "All prices include VAT unless stated otherwise. Rates apply Mon–Fri, 8am–6pm; emergency and out-of-hours work is quoted before dispatch.",
} as const;

import type { CatalogRateCardContent } from "@/lib/catalog-rate-card-content-types";

export const CLIENT_CATALOG_CONTENT: CatalogRateCardContent = {
  hero: CATALOG_HERO,
  about: CATALOG_ABOUT,
  commitments: CATALOG_COMMITMENTS,
  pricingIntro: CATALOG_PRICING_INTRO,
  priceLabel: "Sell rate",
  portalLink: "https://www.getfixfy.com",
  portalLabel: "getfixfy.com",
};
