"use client";

import { cn } from "@/lib/utils";
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
        <select
          ref={ref}
          className={cn(
            "w-full h-9 rounded-lg border border-border bg-card px-3 text-sm text-text-primary",
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
        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      </div>
    );
  }
);

Select.displayName = "Select";
