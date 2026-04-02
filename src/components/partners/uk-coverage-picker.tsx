"use client";

import {
  UK_COVERAGE_REGIONS,
  UK_COVERAGE_WHOLE,
  defaultUkCoverage,
  isWholeUk,
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
  const whole = isWholeUk(value);
  const regionsOnly = value.filter((x) => x !== UK_COVERAGE_WHOLE);

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-text-secondary">Area coverage (UK)</label>
      <button
        type="button"
        id={`${idPrefix}-whole`}
        onClick={() => {
          if (whole) {
            onChange(normalizeUkCoverageRegions(defaultUkCoverage()));
          } else {
            onChange([UK_COVERAGE_WHOLE]);
          }
        }}
        className={`w-full px-3 py-2 rounded-lg text-xs font-medium border text-left transition-all ${
          whole
            ? "border-primary bg-primary/10 text-primary"
            : "border-border-light bg-card text-text-secondary hover:border-border"
        }`}
      >
        Whole UK
      </button>
      <p className="text-[10px] text-text-tertiary">
        {whole
          ? "Nationwide — tap again to pick specific regions."
          : "Select regions this partner covers. Default is London."}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {UK_COVERAGE_REGIONS.map((r) => {
          const active = !whole && regionsOnly.includes(r);
          return (
            <button
              key={r}
              type="button"
              disabled={whole}
              onClick={() => {
                if (whole) return;
                const has = regionsOnly.includes(r);
                const next = has ? regionsOnly.filter((x) => x !== r) : [...regionsOnly, r];
                onChange(normalizeUkCoverageRegions(next.length ? next : defaultUkCoverage()));
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : whole
                    ? "border-border-light/60 bg-surface-hover/50 text-text-tertiary cursor-not-allowed"
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
