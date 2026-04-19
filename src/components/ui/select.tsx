"use client";

import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { forwardRef } from "react";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string; disabled?: boolean }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, options, ...props }, ref) => {
    return (
      <div className="w-full min-w-0">
        {label && (
          <label className="block text-xs font-medium text-text-secondary mb-1.5">{label}</label>
        )}
        <div className="relative w-full min-w-0">
          <select
            ref={ref}
            className={cn(
              "w-full h-9 min-h-9 rounded-lg border border-border bg-card pl-3 pr-10 text-sm leading-9 text-text-primary",
              "appearance-none [-webkit-appearance:none] cursor-pointer",
              "transition-all duration-200",
              "focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30",
              "hover:border-border",
              error && "border-red-300 focus:ring-red-100 focus:border-red-400",
              className
            )}
            {...props}
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2.5 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-text-tertiary max-sm:right-2"
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
