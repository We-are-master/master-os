"use client";

import { cn } from "@/lib/utils";
import {
  ARRIVAL_SLOTS,
  type ArrivalSlotId,
  matchArrivalSlot,
  nearestArrivalSlot,
} from "@/lib/job-arrival-window";

type Props = {
  arrivalFrom: string;
  arrivalWindowMins: string;
  /** Two writes per pick: arrival_from + arrival_window_mins. Parent owns the state. */
  onPick: (from: string, mins: string) => void;
  className?: string;
  /** Compact variant for tight spots (used in Rate Type row alongside Type of Work). */
  compact?: boolean;
  /** Same height as Start Date, to pair on one row. */
  rowLayout?: boolean;
  /** Hide the "Arrival time *" label when the parent renders one already. */
  hideLabel?: boolean;
  /** Display-only — shows active slot without allowing changes. */
  readOnly?: boolean;
};

/**
 * Escolha da janela de chegada, reusada nos modais e na linha de Rate Type.
 * Cada slot é um par (arrival_from, arrival_window_mins), então o schema, o app
 * do parceiro e o calendário seguem com o mesmo contrato.
 *
 * ── Por que é um select e não uma fileira de botões ──────────────────────
 *
 * Eram cinco slots numa grade de cinco colunas, e cabia. Em 01/09/2026 o dono
 * pediu mais dois (hora marcada às 9 e o dia inteiro): sete botões na mesma
 * linha ficam com 10px de fonte e dois órfãos na segunda fileira, e no
 * `rowLayout`, que divide a linha com o Start Date, viram ilegíveis.
 *
 * O select resolve os sete e o oitavo que vier. Perde-se ver todas as opções
 * de relance; ganha-se conseguir ler a que está escolhida, que é o que a tela
 * mostra 99% do tempo.
 */
export function ArrivalSlotPicker({
  arrivalFrom,
  arrivalWindowMins,
  onPick,
  className,
  compact = false,
  rowLayout = false,
  hideLabel = false,
  readOnly = false,
}: Props) {
  const activeSlotId: ArrivalSlotId =
    matchArrivalSlot(arrivalFrom, arrivalWindowMins) ??
    nearestArrivalSlot(arrivalFrom, arrivalWindowMins);
  const activeSlot = ARRIVAL_SLOTS.find((s) => s.id === activeSlotId);

  const control = cn(
    "w-full rounded-md border font-semibold tabular-nums",
    rowLayout
      ? "h-10 min-h-10 px-2 text-xs"
      : compact
        ? "px-2 py-1 text-[11px] leading-tight"
        : "px-2 py-2 text-xs",
  );

  if (readOnly) {
    return (
      <div className={className}>
        {!hideLabel && (
          <label className="block text-xs font-medium text-text-secondary mb-1.5">
            Arrival Time *
          </label>
        )}
        <div
          className={cn(
            control,
            "flex items-center border-primary bg-primary/10 text-primary",
            !rowLayout && "justify-center",
          )}
        >
          {activeSlot?.label ?? "—"}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {!hideLabel && (
        <label
          htmlFor="arrival-slot"
          className="block text-xs font-medium text-text-secondary mb-1.5"
        >
          Arrival Time *
        </label>
      )}
      <select
        id="arrival-slot"
        value={activeSlotId}
        onChange={(e) => {
          const slot = ARRIVAL_SLOTS.find((s) => s.id === e.target.value);
          if (slot) onPick(slot.from, String(slot.mins));
        }}
        className={cn(
          control,
          "cursor-pointer appearance-none bg-card bg-no-repeat pr-7",
          "border-primary text-primary shadow-[0_0_0_1px_var(--color-primary)_inset]",
          "transition-colors hover:border-primary/70",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        )}
        style={{
          // Seta desenhada em CSS: o `appearance-none` tira a nativa, e sem
          // uma no lugar o campo não se anuncia como lista.
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5 6 8l3.5-3.5' fill='none' stroke='%23ED4B00' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
          backgroundPosition: "right 0.5rem center",
          backgroundSize: "0.75rem",
        }}
      >
        {ARRIVAL_SLOTS.map((slot) => (
          <option key={slot.id} value={slot.id}>
            {slot.label}
          </option>
        ))}
      </select>
    </div>
  );
}
