"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STAGE_LABEL } from "@/lib/crm/etapas";
import type { Lead } from "@/types/database";
import { leadValue, type LeadQuote, type TodayItem, type TodayReasonKind } from "@/services/crm-leads";
import { SEGMENT_LABEL, STAGE_VARIANT, formatAgo, gbp } from "./crm-ui";

const REASON: Record<TodayReasonKind, { label: string; tone: string }> = {
  replied: { label: "Customer replied", tone: "text-[var(--bad-ink)]" },
  new_unanswered: { label: "New · no reply", tone: "text-[var(--warn-ink)]" },
  overdue: { label: "Next action overdue", tone: "text-[var(--warn-ink)]" },
  no_next_action: { label: "No next action", tone: "text-text-secondary" },
};

function TodayCard({ item, quote, onOpen }: { item: TodayItem; quote?: LeadQuote | null; onOpen: (l: Lead) => void }) {
  const { lead } = item;
  const stage = lead.stage ?? "new";
  const value = leadValue(lead, quote);
  const r = REASON[item.reason];
  return (
    <button
      type="button"
      onClick={() => onOpen(lead)}
      className="w-full min-w-[13rem] text-left rounded-xl border border-border-light bg-card px-3 py-2.5 hover:border-border hover:shadow-sm transition"
    >
      <p className={cn("text-[10px] font-semibold uppercase tracking-wide", r.tone)}>
        {r.label}
        {item.since ? ` · ${formatAgo(item.since)}` : ""}
      </p>
      <p className="mt-1 text-sm font-medium text-text-primary truncate">{lead.name}</p>
      {item.reason === "overdue" && lead.next_action ? (
        <p className="text-[11px] text-text-tertiary truncate">{lead.next_action}</p>
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge variant={STAGE_VARIANT[stage]} marker={false} className="text-[10px] px-1.5 py-0">
          {STAGE_LABEL[stage]}
        </Badge>
        {value ? <span className="text-[11px] tabular-nums text-text-secondary">{gbp(value)}</span> : null}
        <span className="text-[11px] text-text-tertiary">{SEGMENT_LABEL[lead.segment ?? "b2c"]}</span>
      </div>
    </button>
  );
}

/** Fila Today: faixa no topo (`strip`) ou a aba inteira (`grid`). */
export function TodayQueue({
  items,
  quotes,
  loading,
  layout,
  onOpen,
  limit,
}: {
  items: TodayItem[];
  quotes: Record<string, LeadQuote>;
  loading?: boolean;
  layout: "strip" | "grid";
  onOpen: (l: Lead) => void;
  limit?: number;
}) {
  const shown = limit ? items.slice(0, limit) : items;
  if (layout === "strip") {
    return (
      <section aria-label="Today" className="rounded-xl border border-border-light bg-surface-secondary/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
            Today <span className="tabular-nums text-text-tertiary">{items.length}</span>
          </p>
          {limit && items.length > limit ? (
            <span className="text-[11px] text-text-tertiary">+{items.length - limit} more in the Today tab</span>
          ) : null}
        </div>
        {loading && !items.length ? (
          <p className="text-xs text-text-tertiary">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-text-tertiary">Nothing waiting. Every open lead has a next action in the future.</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {shown.map((it) => (
              <div key={it.lead.id} className="w-56 shrink-0">
                <TodayCard item={it} quote={quotes[it.lead.id]} onOpen={onOpen} />
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }
  if (loading && !items.length) return <p className="py-8 text-center text-sm text-text-tertiary">Loading…</p>;
  if (!items.length) {
    return <p className="py-8 text-center text-sm text-text-tertiary">Nothing waiting. Every open lead has a next action in the future.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {shown.map((it) => (
        <TodayCard key={it.lead.id} item={it} quote={quotes[it.lead.id]} onOpen={onOpen} />
      ))}
    </div>
  );
}
