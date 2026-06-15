export type CatalogRateCardContent = {
  hero: {
    kicker: string;
    titleLine1: string;
    titleLine2: string;
    titleEmphasis: string;
    subtitle: string;
  };
  about: {
    kicker: string;
    title: string;
    lede: string;
    pillars: readonly { num: string; title: string; body: string }[];
  };
  commitments: {
    title: string;
    stats: readonly { value: string; label: string }[];
  };
  pricingIntro: {
    kicker: string;
    title: string;
    lede: string;
  };
  priceLabel: string;
  portalLink: string;
  portalLabel: string;
};
