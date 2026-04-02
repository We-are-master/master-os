"use client";

import {
  UK_COVERAGE_REGIONS,
  defaultUkCoverage,
  normalizeUkCoverageRegions,
} from "@/lib/partner-uk-coverage";

export function UkCoveragePicker({
  value,
  onChange,
  idPrefix = "ukcov",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  idPrefix?: string;
}) {
  const regionsOnly = value.filter(Boolean);

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-text-secondary">Area coverage (UK)</label>
      <p className="text-[10px] text-text-tertiary">
        Add every region this partner covers. Default is <span className="font-medium text-text-secondary">London</span> — tap to add or remove areas.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {UK_COVERAGE_REGIONS.map((r) => {
          const active = regionsOnly.includes(r);
          return (
            <button
              key={r}
              type="button"
              id={`${idPrefix}-${r.replace(/\s+/g, "-").toLowerCase()}`}
              onClick={() => {
                const has = regionsOnly.includes(r);
                const next = has ? regionsOnly.filter((x) => x !== r) : [...regionsOnly, r];
                onChange(normalizeUkCoverageRegions(next.length ? next : defaultUkCoverage()));
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border-light bg-card text-text-secondary hover:border-border"
              }`}
            >
              {r}
            </button>
          );
        })}
      </div>
    </div>
  );
}
