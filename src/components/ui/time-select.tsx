"use client";

import { cn } from "@/lib/utils";
import { Select } from "./select";

type Props = {
  label?: string;
  value?: string;
  onChange: (value: string) => void;
  className?: string;
};

const BASE_TIME_OPTIONS = [{ value: "", label: "Select time" }].concat(
  Array.from({ length: 24 * 4 }, (_, i) => {
    const h = Math.floor(i / 4);
    const m = (i % 4) * 15;
    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    const value = `${hh}:${mm}`;
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const label = `${String(h12).padStart(2, "0")}:${mm} ${period}`;
    return { value, label };
  }),
);

export function TimeSelect({ label, value = "", onChange, className }: Props) {
  const options =
    value && !BASE_TIME_OPTIONS.some((o) => o.value === value)
      ? [{ value, label: value }, ...BASE_TIME_OPTIONS]
      : BASE_TIME_OPTIONS;
  return (
    <div>
      {label ? <label className="block text-xs font-medium text-text-secondary mb-1.5">{label}</label> : null}
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={options}
        className={cn("h-9 rounded-lg border-border bg-card text-sm", className)}
      />
    </div>
  );
}
