/** Preset lengths for arrival window end = start + N minutes (supports crossing midnight). */
export const ARRIVAL_WINDOW_OPTIONS = [
  { value: "", label: "Select length…" },
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "45", label: "45 minutes" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1.5 hours" },
  { value: "120", label: "2 hours" },
  { value: "180", label: "3 hours" },
  { value: "240", label: "4 hours" },
  { value: "540", label: "9 hours" },
  // Zero = hora marcada, sem janela. Fica no fim porque e o caso raro, e
  // aparece na lista para o rotulo do slot "09AM sharp" ter onde resolver.
  { value: "0", label: "No window (fixed time)" },
] as const;

/**
 * Fixed arrival slots for one-off jobs. Backed by the same `arrival_from` +
 * `arrival_window_mins` columns — picking a slot just sets both at once, so
 * the schema, partner app, calendar, and SLA all keep working unchanged.
 */
export type ArrivalSlotId =
  | "nine_sharp"
  | "earlier_morning"
  | "morning"
  | "early_afternoon"
  | "afternoon"
  | "evening"
  | "all_day";

export const ARRIVAL_SLOTS: { id: ArrivalSlotId; label: string; from: string; mins: number }[] = [
  // earlier_morning e o 12PM no early_afternoon: pedido do dono (30/08). O id
  // `earlier_morning` ja era aceito pela API (ARRIVAL_SLOT_LOOKUP) e pelas
  // macros do Zendesk (`arrival_earlier_morning`) — a UI que nao mostrava.
  // Dois pedidos do dono (01/09): hora marcada as 9 e o dia inteiro.
  //
  // `nine_sharp` tem `mins: 0` de proposito: nao e uma janela curta, e a
  // ausencia de janela. O parceiro chega as 09:00, ponto. Um "09:00-09:15"
  // diria ao cliente que ha folga onde nao ha.
  { id: "nine_sharp",      label: "09AM sharp", from: "09:00", mins: 0 },
  { id: "earlier_morning", label: "08AM–09AM", from: "08:00", mins: 60 },
  { id: "morning",         label: "09AM–12PM", from: "09:00", mins: 180 },
  { id: "early_afternoon", label: "12PM–03PM", from: "12:00", mins: 180 },
  { id: "afternoon",       label: "03PM–06PM", from: "15:00", mins: 180 },
  { id: "evening",         label: "06PM–08PM", from: "18:00", mins: 120 },
  // O dia inteiro: 9 horas. Serve para diaria de handyperson e para limpeza
  // grande, em que a janela E o expediente.
  { id: "all_day",         label: "09AM–06PM", from: "09:00", mins: 540 },
];

/**
 * Grafia antiga do early_afternoon (13:00 + 120min, o "01PM–03PM"). Jobs
 * gravados antes da mudanca continuam casando com o slot certo em vez de
 * cair no vizinho mais proximo.
 */
const LEGACY_SLOT_VALUES: { id: ArrivalSlotId; from: string; mins: number }[] = [
  { id: "early_afternoon", from: "13:00", mins: 120 },
];

/** Map a stored (from, mins) pair back to a slot id — exact match only. */
export function matchArrivalSlot(from: string, mins: string | number): ArrivalSlotId | null {
  const m = typeof mins === "string" ? Number(mins) : mins;
  if (!Number.isFinite(m)) return null;
  const slot = ARRIVAL_SLOTS.find((s) => s.from === from && s.mins === m);
  if (slot) return slot.id;
  return LEGACY_SLOT_VALUES.find((s) => s.from === from && s.mins === m)?.id ?? null;
}

/** Canonical (from, mins) for a fixed slot — use when hydrating slot UI from stored timestamps. */
export function canonicalArrivalSlotValues(
  from: string,
  mins: string | number,
): { from: string; mins: string } {
  const slotId = matchArrivalSlot(from, mins) ?? nearestArrivalSlot(from, mins);
  const slot = ARRIVAL_SLOTS.find((s) => s.id === slotId);
  if (!slot) return { from, mins: String(mins) };
  return { from: slot.from, mins: String(slot.mins) };
}

/** Closest-fit slot for legacy values that don't exactly match an option. */
export function nearestArrivalSlot(from: string, mins: string | number): ArrivalSlotId {
  const m = typeof mins === "string" ? Number(mins) || 0 : mins || 0;
  const [hh, mm] = from.split(":").map(Number);
  const startMinutes = (Number.isFinite(hh) ? hh : 9) * 60 + (Number.isFinite(mm) ? mm : 0);
  let best: ArrivalSlotId = "morning";
  let bestDist = Infinity;
  for (const slot of ARRIVAL_SLOTS) {
    const [shh, smm] = slot.from.split(":").map(Number);
    const slotStart = shh * 60 + smm;
    const dist = Math.abs(slotStart - startMinutes) + Math.abs(slot.mins - m) / 4;
    if (dist < bestDist) {
      bestDist = dist;
      best = slot.id;
    }
  }
  return best;
}

/**
 * `0` e `540` entram por causa dos slots `nine_sharp` e `all_day`.
 *
 * Sem eles o valor gravado nao volta para o slot certo: 540 era achatado no
 * teto de 240 e o job reabria mostrando outra janela, e 0 virava string vazia,
 * que apagava o slot na tela.
 */
const ALLOWED_MINS = [0, 15, 30, 45, 60, 90, 120, 180, 240, 540];

/** Pick closest preset for hydrating the arrival-window dropdown from stored start/end. */
export function snapArrivalWindowMinutes(startMs: number, endMs: number): string {
  const mins = Math.round((endMs - startMs) / 60000);
  if (!Number.isFinite(mins) || mins < 0) return "";
  // Fim igual ao inicio e hora marcada, nao ausencia de janela: devolve "0"
  // para o `matchArrivalSlot` achar o `nine_sharp`.
  if (mins === 0) return "0";
  if (mins > 540) return "540";
  const best = ALLOWED_MINS.reduce((a, b) => (Math.abs(b - mins) < Math.abs(a - mins) ? b : a));
  return String(best);
}

export function scheduledEndFromWindow(scheduledDate: string, fromHm: string, windowMinutes: number): string {
  const [yy, mo, dd] = scheduledDate.split("-").map(Number);
  const [hh, mi] = fromHm.split(":").map(Number);
  const start = new Date(yy, mo - 1, dd, hh, mi, 0);
  const end = new Date(start.getTime() + windowMinutes * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}:00`;
}
