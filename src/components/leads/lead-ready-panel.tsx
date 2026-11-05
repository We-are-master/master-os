"use client";

import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ItemDoChecklist } from "@/lib/crm/pronto-para-job";

/** Checklist "Ready for job": destrava o Mark won. */
export function LeadReadyPanel({ items }: { items: ItemDoChecklist[] }) {
  const ok = items.filter((i) => i.ok).length;
  return (
    <div className="rounded-xl border border-border-light p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Ready for job</p>
        <span className={cn("text-[11px] tabular-nums font-semibold", ok === items.length ? "text-[var(--ok-ink)]" : "text-text-tertiary")}>
          {ok} of {items.length}
        </span>
      </div>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.key} className="flex items-start gap-2 text-[12px]">
            {i.ok ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ok-ink)]" aria-label="done" />
            ) : (
              <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--bad-ink)]" aria-label="missing" />
            )}
            <span className="font-medium text-text-primary w-28 shrink-0">{i.label}</span>
            <span className={cn("min-w-0", i.ok ? "text-text-tertiary" : "text-[var(--bad-ink)]")}>{i.detail}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-text-tertiary">With everything green, Mark won opens the job creation already filled in.</p>
    </div>
  );
}
