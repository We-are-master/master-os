"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const refusedBadgeClassName = cn(
  "!text-red-950 !bg-red-950/[0.1] !ring-red-950/35 border border-red-950/30",
  "dark:!text-red-100 dark:!bg-red-950/50 dark:!ring-red-900/45 dark:border-red-900/55",
);

export type JobCardRefusedInput = {
  card_charge_status?: string | null;
  card_refused_reason?: string | null;
  card_retry_at?: string | null;
};

/**
 * O job fica em final check quando o cartão salvo recusa o restante (Fase 0). Sem esta
 * etiqueta, quem abre o job depois não vê por que ele está parado.
 */
export function JobCardRefusedBadge({ job: jobRow, size = "sm" }: { job: object; size?: "sm" | "md" }) {
  // `Job` ainda não declara as colunas da migration 319; lê pelo formato delas.
  const job = jobRow as JobCardRefusedInput;
  const st = job.card_charge_status;
  if (st !== "refused" && st !== "requires_action") return null;
  const label = st === "refused" ? "Card refused" : "Card needs confirming";
  const retry = st === "refused" && job.card_retry_at
    ? ` Next automatic try: ${new Date(job.card_retry_at).toLocaleDateString("en-GB", { timeZone: "Europe/London" })}.`
    : st === "refused"
      ? " No automatic retry: send the pay link."
      : " The customer has to confirm with their bank: send the pay link.";
  const title = `${job.card_refused_reason?.trim() || label}.${retry}`;
  return (
    <span title={title} className="inline-flex">
      <Badge variant="outline" size={size} className={refusedBadgeClassName}>
        {label}
      </Badge>
    </span>
  );
}
