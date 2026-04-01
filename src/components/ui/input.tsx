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
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">
            {icon}
          </div>
        )}
        <input
          ref={ref}
          className={cn(
            "w-full h-9 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm text-text-primary placeholder:text-text-tertiary",
            "transition-all duration-200",
            "focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30",
            "hover:border-border",
            isDateOrTime && "h-10 rounded-xl bg-surface-hover/40 border-border-light font-medium",
            icon && "pl-9",
            error && "border-red-300 focus:ring-red-100 focus:border-red-400",
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
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
      placeholder="Search..."
      className={className}
      {...props}
    />
  );
}
