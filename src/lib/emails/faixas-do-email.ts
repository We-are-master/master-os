/**
 * Faixas do "Painel de status" (moldura `emailFixfy`): métricas e progresso.
 *
 * Só monta os dados; o desenho mora em fixfy-shell.ts. Cada e-mail ao cliente
 * escolhe os passos da sua jornada e marca qual é o atual.
 */
import { janelaDeTexto, type Metrica, type Passo } from "./fixfy-shell";

/**
 * A janela na célula de métrica, no formato único `09:00-12:00` (dono,
 * 23/10/2026). Texto antigo (`between 9am and midday`) é convertido.
 */
export function janelaCurta(janela: string | null | undefined): string | null {
  const t = String(janela ?? "").trim();
  if (!t) return null;
  return janelaDeTexto(t) ?? t;
}

/** Passos com o de índice `atual` marcado; os anteriores feitos, os seguintes futuros. */
export function passosAte(nomes: readonly string[], atual: number): Passo[] {
  return nomes.map((nome, i) => ({ nome, estado: i < atual ? "feito" : i === atual ? "atual" : "futuro" }));
}

/** Booking, confirmação e remarcação. */
export const PASSOS_VISITA = ["Requested", "Confirmed", "On the day", "Done"] as const;
/** Pagamento para confirmar a reserva. */
export const PASSOS_PAGAMENTO_RESERVA = ["Quote", "Pay to confirm", "Confirmed", "Done"] as const;
/** Fatura, recibo, parcela, cobrança e reembolso. */
export const PASSOS_FATURA = ["Booked", "Work done", "Invoice sent", "Paid"] as const;
/** Cotação. */
export const PASSOS_COTACAO = ["Request", "Quote ready", "Accepted", "Booked"] as const;

/** Data e janela da visita (janela sem "between"). */
export function metricasDaVisita(data: string | null | undefined, janela: string | null | undefined): Metrica[] {
  const curta = janelaCurta(janela);
  // Sem janela, a célula Arrival some e a data avisa embaixo (nada de "Arrival:" sem hora).
  return [
    { rotulo: "Date", valor: String(data ?? "").trim(), sub: curta ? null : "Arrival time to be confirmed" },
    { rotulo: "Arrival", valor: curta ?? "" },
  ];
}
