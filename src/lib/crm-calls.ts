/**
 * Registro de ligação do CRM B2B: cada resultado escreve uma linha datada no
 * topo das notas e já marca o próximo passo (e a etapa, quando o resultado
 * muda a etapa). As datas são do fuso de quem está ligando.
 */

import type { CrmDeal, CrmStage } from "@/types/database";

export type CallOutcome = "no_answer" | "voicemail" | "call_back" | "interested" | "meeting" | "not_interested";

export const CALL_OUTCOMES: { id: CallOutcome; label: string }[] = [
  { id: "no_answer", label: "No answer" },
  { id: "voicemail", label: "Voicemail" },
  { id: "call_back", label: "Call back" },
  { id: "interested", label: "Interested" },
  { id: "meeting", label: "Meeting booked" },
  { id: "not_interested", label: "Not interested" },
];

const pad = (n: number) => String(n).padStart(2, "0");

/** Data local no formato do banco (YYYY-MM-DD). */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `n` dias úteis depois de `from` (pula sábado e domingo). */
export function addBusinessDays(from: Date, n: number): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const weekday = d.getDay();
    if (weekday !== 0 && weekday !== 6) left--;
  }
  return isoDate(d);
}

/** Card para ligar hoje: tem data vencida ou de hoje e não está numa etapa de perdido. */
export function isCallDue(deal: Pick<CrmDeal, "next_step_date">, stageKind: string | undefined, today: string): boolean {
  return !!deal.next_step_date && deal.next_step_date <= today && stageKind !== "lost";
}

export type CallFields = Pick<CrmDeal, "stage_id" | "notes" | "next_step" | "next_step_date">;

export function applyCallOutcome(
  deal: CallFields,
  outcome: CallOutcome,
  stages: CrmStage[],
  now: Date,
  note?: string,
): CallFields {
  const label = CALL_OUTCOMES.find((o) => o.id === outcome)?.label ?? outcome;
  const stamp = `${pad(now.getDate())}/${pad(now.getMonth() + 1)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const line = [stamp, label, note?.trim()].filter(Boolean).join(" · ");
  const notes = deal.notes?.trim() ? `${line}\n${deal.notes}` : line;
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  const current = ordered.find((s) => s.id === deal.stage_id);
  // Data que a pessoa já deixou marcada no futuro vale mais que o padrão.
  const keepFuture = (fallback: string) =>
    deal.next_step_date && deal.next_step_date > isoDate(now) ? deal.next_step_date : fallback;

  switch (outcome) {
    case "no_answer":
      return { ...deal, notes, next_step: "Call again", next_step_date: addBusinessDays(now, 1) };
    case "voicemail":
      return { ...deal, notes, next_step: "Call again (left a voicemail)", next_step_date: addBusinessDays(now, 2) };
    case "call_back":
      return { ...deal, notes, next_step: "Call back", next_step_date: keepFuture(addBusinessDays(now, 2)) };
    case "interested":
      return { ...deal, notes, next_step: "Send the price list, then follow up", next_step_date: addBusinessDays(now, 1) };
    case "meeting": {
      const index = ordered.findIndex((s) => s.id === deal.stage_id);
      const next = index >= 0 ? ordered.slice(index + 1).find((s) => s.kind === "open") : undefined;
      return { ...deal, notes, stage_id: next?.id ?? deal.stage_id, next_step: "Meeting", next_step_date: keepFuture(addBusinessDays(now, 1)) };
    }
    case "not_interested": {
      // Conta que já é cliente não vira "perdido" por uma ligação de reativação.
      const lost = current?.kind === "won" ? undefined : ordered.find((s) => s.kind === "lost");
      return { ...deal, notes, stage_id: lost?.id ?? deal.stage_id, next_step: null, next_step_date: null };
    }
  }
}
