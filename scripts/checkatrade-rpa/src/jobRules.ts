/**
 * Which Express jobs are worth taking.
 *
 * Revised with the business on 2026-08-11. Two floors, one exclusion:
 *   - EPC                     → never. Not worth the slot at £56-97.
 *   - other certificates      → take at >= £70
 *   - everything else         → take at >= £100
 *
 * This replaces the 2026-07-28 rules, which had no floor on certificates, a
 * £120 floor on named trades and day bookings, and rejected one-off tasks
 * outright however much they paid. Price now decides, not shape: a £150 one-off
 * was being declined while a £120 half-day was taken, which is backwards.
 *
 * The wrinkle: Checkatrade titles never say "handyman". The whole account is
 * registered under General Maintenance, so every job is nominally handyperson
 * work — what separates them is the SERVICE. So rather than trying to detect
 * handyman work, we detect the three things worth taking and reject the rest.
 * That makes the default safe (a title we don't recognise is declined, not
 * accepted blind) and every decision is logged with its bucket so the keyword
 * lists can be corrected from real traffic.
 */

export type JobBucket = "excluded" | "certificate" | "trade" | "day-booking" | "small-task";

/**
 * EPC is out on its own. It bands £56.35 to £97.30, so most of them sit under
 * the certificate floor anyway, and the business would rather the slot went to
 * an EICR at £100-£203.50. Checked before the certificate test, because the
 * certificate pattern matches "energy performance" too.
 */
const EPC = /\bepc\b|energy performance/i;

/** Out of scope entirely, whatever it pays. */
/**
 * `patio` needs the lookahead: "patio doors" is glazing/joinery work, not
 * gardening. Without it a "Roller Blind Installation (Up to 3m)" was rejected
 * on 2026-08-03 because its brief mentioned patio doors — the blocklist reads
 * the description too, so a single word in the customer's notes was enough to
 * drop a perfectly good job.
 */
const EXCLUDED = /garden|landscap|lawn|hedge|fence|patio(?!\s*door)|decking|turf|weeding/i;

/**
 * Certificates and inspections. These are the bread and butter — the business
 * has people for them, so price is not a gate.
 * Seen live: "2-Bed EICR Electrical Safety Check", "Gas Safety Check (CP12) x2
 * Appliances", "Fire Risk Assessment - 4 Bed House".
 */
const CERTIFICATE =
  /\beicr\b|electrical installation condition|\bcp12\b|gas safety|gas safe\b|\bepc\b|energy performance|\bpat\b|portable appliance|fire risk assessment|\bfra\b|fire alarm|emergency lighting|fire extinguisher|\bgsc\b|\bfac\b|certificate|safety check|safety inspection/i;

/**
 * A named trade the business already runs as an active service. Seen live:
 * "Toilet Leak Repair", "Leaking Tap Repair", "Side Bath Panel Installation",
 * "Gas Boiler Service", "Under-Sink Leak Repair".
 */
const TRADE =
  /plumb|\btap\b|toilet|sink|\bleak|basin|\bbath\b|bath panel|shower|radiator|\bboiler|gas\b|electric|rewire|socket|fuse|consumer unit|carpen|joiner|\bpaint|decorat|plaster|\bclean(ing)?\b|end of tenancy|after builders|deep clean/i;

/**
 * A booked block of a tradesperson's time rather than a single task.
 * Seen live on the detail page: "Handyperson: Full Day (7 Hrs) General
 * Repairs"; in the brief: "How much help do you need?: A full day (up to 7
 * hours)" / "Up to half a day (3.5 hours)".
 */
const FULL_DAY = /full day|for the day\b|\b7\s*(hrs?|hours?)/i;
const HALF_DAY = /half[\s-]?a?[\s-]?day|\b3\.5\s*(hrs?|hours?)/i;

export function dayLength(text: string): "full" | "half" | null {
  if (FULL_DAY.test(text)) return "full";
  if (HALF_DAY.test(text)) return "half";
  return null;
}

export function classifyJob(text: string): JobBucket {
  if (EXCLUDED.test(text)) return "excluded";
  if (CERTIFICATE.test(text)) return "certificate";
  if (dayLength(text)) return "day-booking";
  if (TRADE.test(text)) return "trade";
  return "small-task";
}

/**
 * EICR and the top-paying jobs get chased hardest: taken first in the cycle,
 * and allowed onto any weekday at short notice instead of the Tue-Fri /
 * two-days-ahead rule the rest follow.
 *
 * Why these two: on 2026-08-04 the board held 28 EICRs (£100-£203.50, mean
 * £127.64) and every one was already Taken — they are the most contested thing
 * we want. £150 is the board's top decile (median £81.55, top quartile £110),
 * so it separates genuinely high-value work from routine tasks without a
 * number pulled out of the air.
 */
const EICR = /\beicr\b|electrical installation condition/i;
export const HIGH_VALUE_DEFAULT = 150;

/**
 * Preço do parceiro por certificado, e por faixa.
 *
 * Acordado com o LandLord Certificate em 14 ago 2026. É daqui que sai o piso
 * de cada certificado: o que a Checkatrade paga tem que cobrir o que pagamos ao
 * parceiro, mais margem. Um piso único não serve mais, porque o EICR passou a
 * ter três faixas por tamanho do imóvel.
 *
 * Quando o título não diz o tamanho, assumimos a faixa do meio (£79) e não a
 * mais barata: errar para cima recusa um job, errar para baixo aceita um
 * prejuízo, e só um dos dois custa dinheiro.
 */
export const PRECO_PARCEIRO = {
  epc: 79,
  gasAte2Aparelhos: 60,
  gas3Aparelhos: 70,
  eicrStudio: 69,
  eicr1a2Quartos: 79,
  eicr3a4Quartos: 99,
  /** Hora avulsa de handyperson. Pagamos no mínimo uma, mesmo em job curto. */
  hora: 40,
  meiaDiaria: 100,
  diaria: 200,
} as const;

/**
 * Margem mínima sobre o preço do parceiro, em fração da venda.
 *
 * Zero, e é uma decisão de negócio e não descuido: o parceiro está ocioso, o
 * slot vazio não rende nada, e lucro pequeno é lucro. Um EICR a £85 contra £79
 * deixa £6; recusá-lo por não fechar 10% seria trocar £6 por £0.
 *
 * O que não passa é empatar ou perder — daí o centavo no piso.
 *
 * Fica configurável porque a decisão pode mudar quando houver mais job bom que
 * gente para fazer: aí o slot passa a ter custo de oportunidade e a margem
 * volta a ser um filtro útil.
 */
export const MARGEM_MINIMA_PCT_DEFAULT = 0;

/**
 * O mínimo que a Checkatrade precisa pagar para o job dar a margem pedida.
 *
 * `custo / (1 - pct)` e não `custo * (1 + pct)`: margem se mede sobre a venda,
 * não sobre o custo. A £79 de parceiro, 10% de margem pede £87,78 — não £86,90.
 */
export function pisoParaMargem(custo: number, pct: number): number {
  return Math.round((custo / (1 - pct)) * 100) / 100;
}

/** Quantos quartos o título anuncia, ou null quando não diz. */
export function quartosNoTitulo(text: string): number | null {
  if (/\bstudio\b/i.test(text) && !/\d\s*[-\s]?bed/i.test(text)) return 0;
  const m = text.match(/(\d)\s*[-\s]?bed/i);
  return m ? Number(m[1]) : null;
}

/** Quantos aparelhos de gás o título anuncia. Sem número, assume 1. */
export function aparelhosNoTitulo(text: string): number {
  const m = text.match(/x\s*(\d)\s*appliance|(\d)\s*appliances?/i);
  const n = m ? Number(m[1] ?? m[2]) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

const GAS = /\bcp12\b|gas safety|gas safe\b|\bgsc\b/i;

/**
 * O que pagaríamos ao parceiro por este job, ou null se não é um certificado
 * com preço acordado — aí o piso genérico decide.
 */
export type CustoParceiro =
  /**
   * Quanto o parceiro cobra por este job.
   *
   * `aoMenos` marca imóvel acima da última faixa cotada. Um EICR de 5 quartos
   * custa pelo menos o que custa um de 4, então o piso sai daí. É um mínimo,
   * não um preço: se a conta não fecha nem com ele, não fecharia com o real.
   */
  | { tipo: "acordado"; valor: number; aoMenos?: boolean }
  /** Não é um certificado que o parceiro cotou: cai no piso genérico. */
  | null;

export function custoDoParceiro(text: string): CustoParceiro {
  const acordado = (valor: number): CustoParceiro => ({ tipo: "acordado", valor });

  if (EPC.test(text)) {
    // O parceiro cotou "EPC 79 up to 3 bed". Acima disso não há preço, e sem
    // custo não há como garantir que sobre dinheiro — que é a única razão de
    // pegarmos um job.
    // Cotado só até 3 quartos; acima disso custa pelo menos isso.
    const q = quartosNoTitulo(text);
    return q !== null && q > 3
      ? { tipo: "acordado", valor: PRECO_PARCEIRO.epc, aoMenos: true }
      : acordado(PRECO_PARCEIRO.epc);
  }
  if (GAS.test(text)) {
    const n = aparelhosNoTitulo(text);
    return {
      tipo: "acordado",
      valor: n >= 3 ? PRECO_PARCEIRO.gas3Aparelhos : PRECO_PARCEIRO.gasAte2Aparelhos,
      // 4 aparelhos não foi cotado, mas não custa menos que 3.
      aoMenos: n >= 4,
    };
  }
  if (EICR.test(text) || /electrical (installation|safety)/i.test(text)) {
    const q = quartosNoTitulo(text);
    if (q === null) return acordado(PRECO_PARCEIRO.eicr1a2Quartos);
    if (q === 0) return acordado(PRECO_PARCEIRO.eicrStudio);
    if (q <= 2) return acordado(PRECO_PARCEIRO.eicr1a2Quartos);
    if (q <= 4) return acordado(PRECO_PARCEIRO.eicr3a4Quartos);
    // Acima de 4 quartos não foi cotado, mas custa pelo menos a faixa de 3-4.
    return { tipo: "acordado", valor: PRECO_PARCEIRO.eicr3a4Quartos, aoMenos: true };
  }
  return null;
}

/** Certificado sem preço acordado cai neste piso. */
export const CERT_MIN_DEFAULT = 70;

/** Cheap check from the LIST CARD, for ordering the queue before any page load. */
export function isPriority(text: string, price: number | undefined, highValueMin: number): boolean {
  if (EICR.test(text)) return true;
  return price != null && price >= highValueMin;
}

export type JobVerdict = {
  ok: boolean;
  bucket: JobBucket;
  reason: string;
  /** Chase this one: skip the weekday/notice restrictions and take it first. */
  priority: boolean;
};

/**
 * @param text  everything we know about the job — title + description. Pass the
 *              DETAIL page's title and brief when available: the list card is
 *              too thin to tell a day booking from a one-off task.
 * @param price the card's "Earnings £X" (what Checkatrade pays us).
 * @param nonCertMinValue floor for everything EXCEPT certificates (£100).
 * @param highValueMin     at or above this, a job is chased as priority (£150).
 * @param certMinValue     floor for certificates (£70). EPC is excluded outright.
 */
export function evaluateJob(
  text: string,
  price: number | undefined,
  nonCertMinValue: number,
  highValueMin: number = HIGH_VALUE_DEFAULT,
  certMinValue: number = CERT_MIN_DEFAULT,
  margemMinimaPct: number = MARGEM_MINIMA_PCT_DEFAULT,
): JobVerdict {
  const bucket = classifyJob(text);
  const priority = isPriority(text, price, highValueMin);

  /** Shared floor check. Every bucket is priced now, certificates included. */
  const belowFloor = (label: string, floor: number): JobVerdict | null => {
    if (price == null) {
      return { ok: false, bucket, priority, reason: "NO PRICE PARSED from card — check the card selectors" };
    }
    if (price < floor) {
      return { ok: false, bucket, priority, reason: `${label} at £${price} < £${floor} floor` };
    }
    return null;
  };

  switch (bucket) {
    case "excluded":
      return {
        ok: false,
        bucket,
        priority: false,
        reason: "out of scope (garden work)",
      };

    case "certificate":
      // A scrape failure must not lose an EICR. Certificates band £64 to £220
      // against a £70 floor, so guessing "take" costs at most a cheap CP12 and
      // saves the most contested job on the board. Deliberate since 2026-08-04.
      if (price == null) {
        return { ok: true, bucket, priority, reason: "certificate, price not parsed, taken anyway" };
      }
      {
        // O piso é o que pagaríamos ao parceiro, mais a margem mínima. Cada
        // certificado segue a sua própria conta: um EICR de 3 quartos precisa
        // pagar mais que um studio porque nos custa mais. Certificado sem
        // preço acordado cai no piso genérico.
        const custo = custoDoParceiro(text);

        // Margem 0 quer dizer "só precisa passar do custo": o centavo evita
        // aceitar um job que empata, que não é lucro nenhum.
        const piso =
          custo === null
            ? certMinValue
            : margemMinimaPct === 0
              ? custo.valor + 0.01
              : pisoParaMargem(custo.valor, margemMinimaPct);
        const rotulo =
          custo === null
            ? "certificate"
            : `certificate (partner ${custo.aoMenos ? "≥" : ""}£${custo.valor})`;
        return (
          belowFloor(rotulo, piso) ?? {
            ok: true,
            bucket,
            priority,
            reason:
              custo === null
                ? `certificate at £${price}`
                : `certificate at £${price}, partner £${custo.valor}, margin £${(price - custo.valor).toFixed(2)} (${Math.round(((price - custo.valor) / price) * 100)}%)`,
          }
        );
      }

    case "day-booking": {
      // Do Checkatrade nada chega por hora: mesmo um anúncio de "full day" é
      // job fechado, e quem decide quantas pessoas e quantas horas somos nós.
      // Por isso a diária do parceiro (£200) não vira piso — ela é o custo de
      // UMA forma de fazer, não o custo deste job.
      const len = dayLength(text);
      return (
        belowFloor(`${len} day`, nonCertMinValue) ??
        { ok: true, bucket, priority, reason: `${len} day at £${price}` }
      );
    }

    case "trade":
      return (
        belowFloor("named trade", nonCertMinValue) ??
        { ok: true, bucket, priority, reason: `named trade at £${price}` }
      );

    case "small-task":
      // Was rejected outright however much it paid. Now it clears on price like
      // everything else: the shape of the job never justified declining £150.
      // The bucket stays for the log, so the keyword lists can still be
      // corrected from what actually shows up.
      return (
        belowFloor("one-off task", nonCertMinValue) ??
        { ok: true, bucket, priority, reason: `one-off task at £${price}` }
      );
  }
}
