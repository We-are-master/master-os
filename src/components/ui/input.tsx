"use client";

import { cn } from "@/lib/utils";
import { forwardRef } from "react";
import { Search } from "lucide-react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, icon, error, ...props }, ref) => {
    const isDateOrTime = props.type === "date" || props.type === "time" || props.type === "datetime-local";
    return (
      <div className="relative">
        {icon && (
          <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary [&_svg]:h-3.5 [&_svg]:w-3.5">
            {icon}
          </div>
        )}
        <input
          ref={ref}
          className={cn(
            // VOS UNO field: height by context (--field-h: 38 page · 36 wizard · 32 modal), radius 8, neutral focus.
            "w-full h-[var(--field-h,38px)] rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-[11px] text-[13px] text-text-primary placeholder:text-text-tertiary",
            "transition-colors duration-150",
            "focus:outline-none focus:border-text-tertiary focus:ring-[3px] focus:ring-text-primary/10",
            "hover:border-text-tertiary",
            isDateOrTime && "tabular-nums",
            icon && "pl-[30px]",
            error && "border-danger focus:border-danger focus:ring-danger/15",
            className
          )}
          {...props}
        />
        {error && <p className="mt-1 text-[12px] text-danger">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";

export function SearchInput({
  className,
  ...props
}: Omit<InputProps, "icon">) {
  return (
    <Input
      icon={<Search className="h-4 w-4" />}
      placeholder="Search"
      className={className}
      {...props}
    />
  );
}
