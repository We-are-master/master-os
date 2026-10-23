/**
 * Booking da Housekeep é por hora (regra do dono, 23/10/2026).
 *
 * O e-mail "Job booked" deles traz a linha "Hours 1.0 hrs · Total £60.00": é
 * a taxa por hora deles vezes as horas, não um preço fechado. O job nasce
 * Hourly com a taxa = total ÷ horas. Só nasce Fixed quando o booking veio de
 * uma quote nossa (aí o preço é o da quote) ou quando é limpeza (EoT e deep
 * clean têm preço de tabela).
 *
 * O parceiro ganha £40/h fixo nesses jobs (dono, 23/10/2026), seja qual for a
 * taxa da Housekeep.
 */

export const TAXA_PARCEIRO_HOUSEKEEP_GBP = 40;

export type CobrancaPorHora = {
  rate_type: "hourly";
  hourly_client_rate: number;
  hourly_partner_rate: number;
  billed_hours: number;
};

/** "1.0 hrs", "2 hours", "1.5 hr": a primeira que aparecer no texto. */
export function horasDoBooking(texto: string | null | undefined): number | null {
  const m = String(texto ?? "").match(/(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)\b/i);
  if (!m) return null;
  const horas = Number(m[1]);
  return Number.isFinite(horas) && horas > 0 && horas <= 12 ? horas : null;
}

export function cobrancaDoBookingHousekeep(i: {
  ehHousekeep: boolean;
  /** O booking casou com uma quote nossa: o preço é o dela, fixo. */
  temQuote: boolean;
  totalGbp: number | null;
  /** Texto do e-mail/card, de onde saem as horas. */
  texto: string | null | undefined;
  /** Título/serviço do job, para deixar limpeza de fora. */
  servico: string | null | undefined;
}): CobrancaPorHora | null {
  if (!i.ehHousekeep || i.temQuote) return null;
  if (/clean/i.test(String(i.servico ?? ""))) return null;
  const horas = horasDoBooking(i.texto);
  if (!horas || !i.totalGbp || i.totalGbp <= 0) return null;
  return {
    rate_type: "hourly",
    hourly_client_rate: Math.round((i.totalGbp / horas) * 100) / 100,
    hourly_partner_rate: TAXA_PARCEIRO_HOUSEKEEP_GBP,
    billed_hours: horas,
  };
}
