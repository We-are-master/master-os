"use client";

import { MicroLabel } from "@/components/fx/primitives";

export type DocRuleRow = {
  id: string;
  enabled: boolean;
  mandatory: boolean;
};

export type DocCatalogEntry = {
  id: string;
  name: string;
  description: string;
  trade?: string;
};

export function DocRulesGroup({
  title,
  entries,
  rules,
  canEdit,
  onPatch,
}: {
  title: string;
  entries: DocCatalogEntry[];
  rules: DocRuleRow[];
  canEdit: boolean;
  onPatch: (id: string, patch: Partial<Pick<DocRuleRow, "enabled" | "mandatory">>) => void;
}) {
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2">
      {title ? <MicroLabel>{title}</MicroLabel> : null}
      <div className="rounded-lg border border-border-light overflow-hidden divide-y divide-border-light">
        <div className="hidden sm:grid sm:grid-cols-[1fr_5.5rem_5.5rem] gap-2 px-3 py-2 bg-surface-hover/60 text-[10px] font-mono uppercase tracking-[0.1em] text-text-tertiary">
          <span>Document</span>
          <span className="text-center">Request</span>
          <span className="text-center">Mandatory</span>
        </div>
        {entries.map((entry) => {
          const rule = ruleById.get(entry.id) ?? { id: entry.id, enabled: true, mandatory: true };
          return (
            <div
              key={entry.id}
              className="grid grid-cols-1 sm:grid-cols-[1fr_5.5rem_5.5rem] gap-2 px-3 py-2.5 items-start sm:items-center"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary">{entry.name}</p>
                <p className="text-[11px] text-text-tertiary leading-snug">
                  {entry.description}
                  {entry.trade ? ` · ${entry.trade}` : ""}
                </p>
              </div>
              <label className="flex items-center justify-start sm:justify-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-border text-primary shrink-0"
                  checked={rule.enabled}
                  disabled={!canEdit}
                  onChange={(e) => onPatch(entry.id, { enabled: e.target.checked })}
                />
                <span className="sm:hidden">Request</span>
              </label>
              <label className="flex items-center justify-start sm:justify-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-border text-primary shrink-0"
                  checked={rule.mandatory}
                  disabled={!canEdit || !rule.enabled}
                  onChange={(e) => onPatch(entry.id, { mandatory: e.target.checked })}
                />
                <span className="sm:hidden">Mandatory</span>
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
