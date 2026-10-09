"use client";

import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { forwardRef } from "react";

export type SelectOption = { value: string; label: string; disabled?: boolean };
export type SelectOptionGroup = { label: string; options: SelectOption[] };

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options?: SelectOption[];
  optionGroups?: SelectOptionGroup[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, options = [], optionGroups, ...props }, ref) => {
    return (
      <div className="w-full min-w-0">
        {label && (
          <label className="mb-1.5 block text-[12px] font-medium text-text-secondary">{label}</label>
        )}
        <div className="relative w-full min-w-0">
          <select
            ref={ref}
            className={cn(
              "w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] pl-[11px] pr-9 text-[13px] text-text-primary",
              "h-[var(--field-h,38px)] py-0",
              "appearance-none [-webkit-appearance:none] cursor-pointer",
              "[&::-ms-expand]:hidden",
              "transition-colors duration-150",
              "focus:outline-none focus:border-text-tertiary focus:ring-[3px] focus:ring-text-primary/10",
              "hover:border-text-tertiary",
              error && "border-danger focus:border-danger focus:ring-danger/15",
              className
            )}
            {...props}
          >
            {optionGroups?.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((opt) => (
                  <option key={`${group.label}-${opt.value}`} value={opt.value} disabled={opt.disabled}>
                    {opt.label}
                  </option>
                ))}
              </optgroup>
            ))}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2.5 top-1/2 z-[1] h-3.5 w-3.5 shrink-0 -translate-y-1/2 text-text-tertiary"
            strokeWidth={2}
            aria-hidden
          />
        </div>
        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      </div>
    );
  }
);

Select.displayName = "Select";
