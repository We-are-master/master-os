"use client";

import { MicroLabel } from "@/components/fx/primitives";

export type FieldRuleRow = {
  id: string;
  visible: boolean;
  mandatory: boolean;
};

export type FieldCatalogEntry = {
  id: string;
  name: string;
  description: string;
  locked?: boolean;
};

export function FieldRulesGroup({
  title,
  entries,
  rules,
  scores,
  canEdit,
  onPatch,
}: {
  title: string;
  entries: FieldCatalogEntry[];
  rules: FieldRuleRow[];
  /** Blended compliance % label per field id (from registration rules). */
  scores?: Record<string, string>;
  canEdit: boolean;
  onPatch: (id: string, patch: Partial<Pick<FieldRuleRow, "visible" | "mandatory">>) => void;
}) {
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2">
      {title ? <MicroLabel>{title}</MicroLabel> : null}
      <div className="rounded-lg border border-border-light overflow-hidden divide-y divide-border-light">
        <div className="hidden sm:grid sm:grid-cols-[1fr_3.75rem_5.5rem_5.5rem] gap-2 px-3 py-2 bg-surface-hover/60 text-[10px] font-mono uppercase tracking-[0.1em] text-text-tertiary">
          <span>Field</span>
          <span className="text-center" title="Share of blended compliance score when mandatory">
            Score
          </span>
          <span className="text-center">Visible</span>
          <span className="text-center">Mandatory</span>
        </div>
        {entries.map((entry) => {
          const rule = ruleById.get(entry.id) ?? { id: entry.id, visible: true, mandatory: true };
          const locked = entry.locked;
          const scoreLabel = scores?.[entry.id] ?? "—";
          return (
            <div
              key={entry.id}
              className="grid grid-cols-1 sm:grid-cols-[1fr_3.75rem_5.5rem_5.5rem] gap-2 px-3 py-2.5 items-start sm:items-center"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary">{entry.name}</p>
                <p className="text-[11px] text-text-tertiary leading-snug">{entry.description}</p>
              </div>
              <div className="flex items-center justify-start sm:justify-center">
                <span
                  className={`text-xs font-mono tabular-nums ${
                    scoreLabel === "—"
                      ? "text-text-tertiary"
                      : scoreLabel === "Opt."
                        ? "text-text-tertiary"
                        : "text-text-secondary font-medium"
                  }`}
                  title={
                    scoreLabel === "Opt."
                      ? "Visible in onboarding but not counted toward compliance"
                      : scoreLabel === "—"
                        ? "Not counted toward compliance (hidden or onboarding-only)"
                        : "Approx. share of blended compliance score"
                  }
                >
                  {scoreLabel}
                </span>
                <span className="sm:hidden ml-2 text-[10px] uppercase tracking-wide text-text-tertiary">Score</span>
              </div>
              <label className="flex items-center justify-start sm:justify-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-border text-primary shrink-0"
                  checked={locked ? true : rule.visible}
                  disabled={!canEdit || locked}
                  onChange={(e) => onPatch(entry.id, { visible: e.target.checked })}
                />
                <span className="sm:hidden">Visible</span>
              </label>
              <label className="flex items-center justify-start sm:justify-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-border text-primary shrink-0"
                  checked={locked ? true : rule.mandatory}
                  disabled={!canEdit || locked || !rule.visible}
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
