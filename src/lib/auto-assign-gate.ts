/**
 * O portão do auto assign — as duas travas que decidem se um job pode entrar
 * na vitrine do portal sem um humano olhar antes:
 *
 * 1. COMPLETUDE: sem Trade, Postcode, Customer Price, Arrival Window, Scope e
 *    Partner Suggested Pay, o parceiro não tem como aceitar de olhos fechados.
 *    Faltou qualquer um → o job fica em unassigned (Needs Review), nunca na
 *    vitrine.
 * 2. PISO DE MARGEM: o sistema sugere 40% (trades) / 30% (cleaning), mas a
 *    proteção de verdade é o piso — trades abaixo de 30% e cleaning abaixo de
 *    20% de margem prevista não saem no automático. Editar um job de £100
 *    para pagar £95 ao parceiro segura o envio com o motivo na tela, em vez
 *    de destruir a margem em silêncio.
 *
 * Só funções puras: quem tem o job chama, quem tem tela mostra o motivo.
 */
import { normalizeTypeOfWork } from "@/lib/type-of-work";
import { marginPercent } from "@/lib/catalog-pricing-floor-ceiling";
import { extractUkPostcode } from "@/lib/uk-postcode";

/** Sugestão de margem na criação (deriva o partner_cost quando não veio). */
export const AUTO_PARTNER_MARGIN_PCT_TRADES = 40;
export const AUTO_PARTNER_MARGIN_PCT_CLEANING = 30;

/** Piso duro: abaixo disso o job NÃO entra no auto assign. */
export const AUTO_ASSIGN_MARGIN_FLOOR_TRADES_PCT = 30;
export const AUTO_ASSIGN_MARGIN_FLOOR_CLEANING_PCT = 20;

export function isCleaningTypeOfWork(value?: string | null): boolean {
  const raw = (value ?? "").trim();
  if (!raw) return false;
  const norm = normalizeTypeOfWork(raw) || raw;
  return /clean/i.test(norm);
}

/** 40% trades / 30% cleaning. O alvo da empresa (Setup) vale para trades quando existir. */
export function suggestedPartnerMarginPctFor(
  serviceType: string | null | undefined,
  companyTargetPct?: number | null,
): number {
  if (isCleaningTypeOfWork(serviceType)) return AUTO_PARTNER_MARGIN_PCT_CLEANING;
  return companyTargetPct ?? AUTO_PARTNER_MARGIN_PCT_TRADES;
}

export function autoAssignMarginFloorPctFor(serviceType: string | null | undefined): number {
  return isCleaningTypeOfWork(serviceType)
    ? AUTO_ASSIGN_MARGIN_FLOOR_CLEANING_PCT
    : AUTO_ASSIGN_MARGIN_FLOOR_TRADES_PCT;
}

export type AutoAssignGateJob = {
  /** Type of work / trade do job (título canônico ou service_type). */
  serviceType: string | null;
  propertyAddress: string | null;
  scope: string | null;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  jobType: "hourly" | "fixed" | string | null;
  clientPrice: number | null;
  partnerCost: number | null;
  hourlyClientRate: number | null;
  hourlyPartnerRate: number | null;
};

export type AutoAssignGateResult =
  | { ok: true; marginPct: number | null }
  | { ok: false; missing: string[]; marginPct: number | null; floorPct: number | null };

/**
 * Decide se o job pode entrar no auto assign. `missing` vem com os nomes que
 * a tela mostra (os mesmos seis campos da regra), e o piso entra como
 * "margin below floor" com os números.
 */
export function autoAssignGate(job: AutoAssignGateJob): AutoAssignGateResult {
  const missing: string[] = [];

  if (!job.serviceType?.trim()) missing.push("Trade");
  if (!extractUkPostcode(job.propertyAddress ?? "")) missing.push("Postcode");

  const isHourly = job.jobType === "hourly";
  const sell = isHourly ? job.hourlyClientRate : job.clientPrice;
  const pay = isHourly ? job.hourlyPartnerRate : job.partnerCost;
  if (!(typeof sell === "number" && sell > 0)) missing.push("Customer price");
  if (!(typeof pay === "number" && pay > 0)) missing.push("Partner suggested pay");

  if (!job.scheduledStartAt?.trim() || !job.scheduledEndAt?.trim()) missing.push("Arrival window");
  if (!job.scope?.trim()) missing.push("Scope");

  const marginPct =
    typeof sell === "number" && typeof pay === "number" ? marginPercent(sell, pay) : null;

  if (missing.length > 0) {
    return { ok: false, missing, marginPct, floorPct: null };
  }

  const floorPct = autoAssignMarginFloorPctFor(job.serviceType);
  if (marginPct == null || marginPct < floorPct) {
    return {
      ok: false,
      missing: [`Margin below floor (${marginPct == null ? "unknown" : `${marginPct.toFixed(0)}%`} < ${floorPct}%)`],
      marginPct,
      floorPct,
    };
  }

  return { ok: true, marginPct };
}

/** Frase única para toast/nota/log: o que travou e por quê. */
export function autoAssignGateBlockText(r: AutoAssignGateResult): string | null {
  if (r.ok) return null;
  return `Auto assign blocked: ${r.missing.join(", ")}. Complete the job in the OS (Needs Review).`;
}
