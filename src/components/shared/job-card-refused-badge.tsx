"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const refusedBadgeClassName = cn(
  "!text-red-950 !bg-red-950/[0.1] !ring-red-950/35 border border-red-950/30",
  "dark:!text-red-100 dark:!bg-red-950/50 dark:!ring-red-900/45 dark:border-red-900/55",
);

export type JobCardRefusedInput = {
  id?: string;
  card_charge_status?: string | null;
  card_refused_reason?: string | null;
  card_retry_at?: string | null;
};

type Tentativa = {
  id: string;
  kind: string;
  amount_pence: number;
  status: string;
  error_code: string | null;
  decline_code: string | null;
  created_at: string;
};

const ROTULO_STATUS: Record<string, string> = {
  succeeded: "Charged",
  failed: "Declined",
  requires_action: "Bank asked to confirm",
  pending: "In progress",
};

const quando = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * O cartão salvo recusou o restante (Fase 0). Desde 14/10/2026 o job segue para
 * Awaiting Payment mesmo assim e este chip mostra por que ele não fechou.
 *
 * Com `showHistory` (tela do job), o chip abre a lista de TODAS as tentativas no
 * cartão: a primeira, as automáticas de 1, 3 e 7 dias e a que passou.
 */
export function JobCardRefusedBadge({
  job: jobRow,
  size = "sm",
  showHistory = false,
}: {
  job: object;
  size?: "sm" | "md";
  showHistory?: boolean;
}) {
  // `Job` ainda não declara as colunas da migration 319; lê pelo formato delas.
  const job = jobRow as JobCardRefusedInput;
  const st = job.card_charge_status;
  const [aberto, setAberto] = useState(false);
  const [tentativas, setTentativas] = useState<Tentativa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const caixa = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  useEffect(() => {
    if (!aberto || tentativas || !job.id) return;
    fetch(`/api/jobs/${job.id}/card-charge`)
      .then((r) => r.json())
      .then((j: { attempts?: Tentativa[]; error?: string }) => {
        if (j.error) setErro(j.error);
        else setTentativas(j.attempts ?? []);
      })
      .catch(() => setErro("Could not load the card attempts."));
  }, [aberto, tentativas, job.id]);

  if (st !== "refused" && st !== "requires_action") return null;
  const label = st === "refused" ? "Card declined" : "Card needs confirming";
  const retry = st === "refused" && job.card_retry_at
    ? ` Next automatic try: ${new Date(job.card_retry_at).toLocaleDateString("en-GB", { timeZone: "Europe/London" })}.`
    : st === "refused"
      ? " No automatic retry: send the pay link or record the payment."
      : " The customer has to confirm with their bank: send the pay link.";
  const title = `${job.card_refused_reason?.trim() || label}.${retry}`;

  const chip = (
    <Badge variant="outline" size={size} className={refusedBadgeClassName}>
      {label}
    </Badge>
  );

  if (!showHistory || !job.id) {
    return (
      <span title={title} className="inline-flex">
        {chip}
      </span>
    );
  }

  return (
    <span ref={caixa} className="relative inline-flex">
      <button type="button" title={title} onClick={() => setAberto((v) => !v)} className="inline-flex" aria-expanded={aberto}>
        {chip}
      </button>
      {aberto ? (
        <span className="absolute left-0 top-full z-50 mt-1.5 block w-80 max-w-[90vw] rounded-lg border border-border bg-card p-3 text-left shadow-lg">
          <span className="block text-xs font-semibold text-text-primary">Card attempts</span>
          <span className="mt-0.5 block text-[11px] text-text-secondary">{title}</span>
          {erro ? <span className="mt-2 block text-xs text-red-600">{erro}</span> : null}
          {!tentativas && !erro ? <span className="mt-2 block text-xs text-text-secondary">Loading…</span> : null}
          {tentativas?.length === 0 ? <span className="mt-2 block text-xs text-text-secondary">No attempts recorded.</span> : null}
          {tentativas?.length ? (
            <span className="mt-2 block max-h-64 overflow-y-auto">
              {tentativas.map((t) => (
                <span key={t.id} className="flex items-baseline justify-between gap-3 border-t border-border py-1.5 text-xs first:border-t-0">
                  <span className="tabular-nums text-text-secondary">{quando(t.created_at)}</span>
                  <span className="min-w-0 flex-1 truncate text-text-primary">
                    {ROTULO_STATUS[t.status] ?? t.status}
                    {t.decline_code || t.error_code ? ` · ${(t.decline_code || t.error_code)?.replace(/_/g, " ")}` : ""}
                  </span>
                  <span className="tabular-nums font-medium text-text-primary">£{(t.amount_pence / 100).toFixed(2)}</span>
                </span>
              ))}
            </span>
          ) : null}
          <span className="mt-2 block text-[11px] text-text-secondary">
            Paid another way? Record the payment on the job with its method (bank transfer, cash…). The job closes and the retries stop.
          </span>
        </span>
      ) : null}
    </span>
  );
}
