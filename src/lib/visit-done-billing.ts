import { billedHoursFromElapsedSeconds } from "@/lib/job-hourly-billing";
import { MATERIAL_CLIENT_MARKUP } from "@/lib/report-material-extra";

/**
 * O Done de uma visita extra (dono, 22/10/2026): antes de fechar, o escritório
 * confirma quanto a visita custou.
 *
 *  - Hourly: chegada e saída → horas pela regra Fixfy (1ª hora mínima, depois de
 *    meia em meia hora) → cliente e parceiro pelas taxas, os dois editáveis.
 *  - Fixed: o combinado, editável, mais uma cobrança extra opcional.
 *  - Material opcional nos dois, com recibo (regra do relatório).
 *
 * Puro: o modal mostra com isto e o servidor grava com isto.
 */

export type VisitRateType = "fixed" | "hourly";

export type VisitDoneInput = {
  rateType: VisitRateType;
  /** Hourly: ISO de chegada e saída. */
  arrivedAt?: string | null;
  departedAt?: string | null;
  hourlyClientRate?: number | null;
  hourlyPartnerRate?: number | null;
  /** Fixed: o combinado. Hourly: o calculado, quando o escritório editou. */
  clientPrice?: number | null;
  partnerCost?: number | null;
  /** Hourly: o escritório sobrescreveu o calculado. */
  clientOverride?: number | null;
  partnerOverride?: number | null;
  /** Fixed: cobrança extra do cliente nesta visita. */
  extraClientCharge?: number | null;
  /** Material: o que o parceiro pagou e o que o cliente paga (padrão: custo × markup). */
  materialsCost?: number | null;
  materialsCharge?: number | null;
  receiptCount?: number;
};

export type VisitDoneAmounts = {
  rateType: VisitRateType;
  billedHours: number | null;
  /** Mão de obra da visita (vai para client_price / partner_cost). */
  clientPrice: number;
  partnerCost: number;
  materialsCost: number;
  materialsCharge: number;
  /** O que o cliente paga e o parceiro recebe por esta visita, material incluído. */
  clientToCharge: number;
  partnerToPay: number;
};

const money = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
};
const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "" && Number.isFinite(Number(v));

/** Horas cobradas entre chegada e saída. `null` quando falta horário ou a saída é antes. */
export function visitBilledHours(arrivedAt?: string | null, departedAt?: string | null): number | null {
  if (!arrivedAt || !departedAt) return null;
  const a = Date.parse(arrivedAt);
  const d = Date.parse(departedAt);
  if (!Number.isFinite(a) || !Number.isFinite(d) || d <= a) return null;
  return billedHoursFromElapsedSeconds((d - a) / 1000);
}

export function computeVisitDoneAmounts(input: VisitDoneInput): VisitDoneAmounts {
  const materialsCost = money(input.materialsCost);
  const materialsCharge = has(input.materialsCharge)
    ? money(input.materialsCharge)
    : Math.round(materialsCost * MATERIAL_CLIENT_MARKUP * 100) / 100;

  let billedHours: number | null = null;
  let clientPrice: number;
  let partnerCost: number;
  if (input.rateType === "hourly") {
    billedHours = visitBilledHours(input.arrivedAt, input.departedAt);
    const horas = billedHours ?? 1;
    clientPrice = has(input.clientOverride)
      ? money(input.clientOverride)
      : Math.round(money(input.hourlyClientRate) * horas * 100) / 100;
    partnerCost = has(input.partnerOverride)
      ? money(input.partnerOverride)
      : Math.round(money(input.hourlyPartnerRate) * horas * 100) / 100;
  } else {
    clientPrice = Math.round((money(input.clientPrice) + money(input.extraClientCharge)) * 100) / 100;
    partnerCost = money(input.partnerCost);
  }
  return {
    rateType: input.rateType,
    billedHours,
    clientPrice,
    partnerCost,
    materialsCost,
    materialsCharge,
    clientToCharge: Math.round((clientPrice + materialsCharge) * 100) / 100,
    partnerToPay: Math.round((partnerCost + materialsCost) * 100) / 100,
  };
}

/** O que impede o Done: horário inválido no hourly, material sem recibo. Em inglês, vai para a tela. */
export function visitDoneProblems(input: VisitDoneInput): string[] {
  const faltas: string[] = [];
  if (input.rateType === "hourly") {
    if (!input.arrivedAt || !input.departedAt) faltas.push("Enter the arrival and departure times");
    else if (visitBilledHours(input.arrivedAt, input.departedAt) == null) faltas.push("Departure must be after arrival");
  }
  for (const [rotulo, v] of [
    ["Client charge", input.clientOverride ?? input.clientPrice],
    ["Partner pay", input.partnerOverride ?? input.partnerCost],
    ["Extra charge", input.extraClientCharge],
    ["Materials", input.materialsCost],
  ] as const) {
    if (has(v) && Number(v) < 0) faltas.push(`${rotulo} cannot be negative`);
  }
  if (money(input.materialsCost) > 0 && (input.receiptCount ?? 0) === 0) {
    faltas.push("Add a photo of the materials receipt");
  }
  return faltas;
}

/**
 * Os totais do job depois desta visita, para o modal mostrar antes de confirmar.
 * `jobClient` / `jobPartner` são os totais de hoje (visita com o valor antigo).
 */
export function jobTotalsAfterVisit(args: {
  jobClient: number;
  jobPartner: number;
  visitClientBefore: number;
  visitPartnerBefore: number;
  amounts: VisitDoneAmounts;
  /** Material desta visita que já estava aplicado (relatório anterior). */
  materialsChargeBefore?: number;
}): { client: number; partner: number; margin: number } {
  const client =
    args.jobClient - money(args.visitClientBefore) + args.amounts.clientPrice +
    (args.amounts.materialsCharge - money(args.materialsChargeBefore));
  const partner = args.jobPartner - money(args.visitPartnerBefore) + args.amounts.partnerCost;
  const r = (n: number) => Math.round(n * 100) / 100;
  return { client: r(client), partner: r(partner), margin: r(client - partner) };
}
