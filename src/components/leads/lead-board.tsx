"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STAGE_LABEL, isOpenStage } from "@/lib/crm/etapas";
import { checklistDoJob, prontoParaJob } from "@/lib/crm/pronto-para-job";
import type { Lead, LeadStage } from "@/types/database";
import { BOARD_STAGES, leadValue, type LeadQuote } from "@/services/crm-leads";
import { SEGMENT_LABEL, formatAgo, formatWhen, gbp, isOverdue } from "./crm-ui";

function BoardCard({
  lead,
  quote,
  semEntrada,
  onOpen,
}: {
  lead: Lead;
  quote?: LeadQuote | null;
  semEntrada: boolean;
  onOpen: (l: Lead) => void;
}) {
  const stage = lead.stage ?? "new";
  const value = leadValue(lead, quote);
  const ready = stage === "accepted" ? prontoParaJob(checklistDoJob({ lead, quote, semEntrada })) : null;
  const overdue = isOpenStage(stage) && isOverdue(lead.next_action_at);
  let meta: string;
  if (stage === "new") meta = formatAgo(lead.created_at);
  else if (stage === "nurture") meta = lead.nurture_until ? `back ${lead.nurture_until.slice(8, 10)}/${lead.nurture_until.slice(5, 7)}` : "";
  else if (stage === "won") meta = "";
  else meta = lead.next_action_at ? formatWhen(lead.next_action_at) : "no next action";
  return (
    <button
      type="button"
      onClick={() => onOpen(lead)}
      className="w-full text-left rounded-lg border border-border-light bg-card px-2.5 py-2 hover:border-border hover:shadow-sm transition"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-text-primary truncate">{lead.name}</p>
        <span className="text-[10px] text-text-tertiary shrink-0">{SEGMENT_LABEL[lead.segment ?? "b2c"]}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {value ? <span className="text-[11px] tabular-nums text-text-secondary">{gbp(value)}</span> : null}
        {meta ? (
          <span className={cn("text-[11px]", overdue || (!lead.next_action_at && isOpenStage(stage)) ? "text-[var(--bad-ink)]" : "text-text-tertiary")}>
            {meta}
          </span>
        ) : null}
        {ready ? (
          <Badge variant={ready.pronto ? "success" : "warning"} className="text-[10px] px-1.5 py-0">
            {ready.pronto ? "ready" : `${ready.faltam} missing`}
          </Badge>
        ) : null}
      </div>
    </button>
  );
}

export function LeadBoard({
  columns,
  counts,
  quotes,
  platformAccounts,
  loading,
  onOpen,
}: {
  columns: Record<string, Lead[]>;
  counts: Record<string, number>;
  quotes: Record<string, LeadQuote>;
  platformAccounts: Set<string>;
  loading?: boolean;
  onOpen: (l: Lead) => void;
}) {
  return (
    <div className="min-w-0 overflow-x-auto -mx-1 px-1 pb-2">
      <div className="flex gap-3 min-w-max">
        {BOARD_STAGES.map((st: LeadStage) => {
          const rows = columns[st] ?? [];
          const total = counts[st] ?? rows.length;
          return (
            <section key={st} aria-label={STAGE_LABEL[st]} className="w-60 shrink-0 rounded-xl bg-surface-secondary/50 p-2">
              <header className="mb-2 flex items-center justify-between px-1">
                <p className="text-xs font-semibold text-text-secondary">{STAGE_LABEL[st]}</p>
                <span className="text-[11px] tabular-nums text-text-tertiary">{total}</span>
              </header>
              <div className="space-y-1.5">
                {loading && !rows.length ? <p className="px-1 text-[11px] text-text-tertiary">Loading…</p> : null}
                {!loading && !rows.length ? <p className="px-1 text-[11px] text-text-tertiary">No leads</p> : null}
                {rows.map((l) => (
                  <BoardCard
                    key={l.id}
                    lead={l}
                    quote={quotes[l.id]}
                    semEntrada={!!l.account_id && platformAccounts.has(l.account_id)}
                    onOpen={onOpen}
                  />
                ))}
                {total > rows.length ? (
                  <p className="px-1 pt-1 text-[11px] text-text-tertiary">+{total - rows.length} more · use List</p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
