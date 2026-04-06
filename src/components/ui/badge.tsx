"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

export type BadgeVariant =
  | "default"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "outline"
  | "violet"
  | "orange";

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-[var(--badge-muted)] text-text-secondary ring-border/50",
  primary: "bg-primary-light text-primary ring-primary/10 dark:bg-primary/15",
  success: "bg-success-light text-emerald-700 ring-emerald-200/50 dark:text-emerald-400",
  warning: "bg-warning-light text-amber-700 ring-amber-200/50 dark:text-amber-400",
  danger: "bg-danger-light text-red-700 ring-red-200/50 dark:text-red-400",
  info: "bg-info-light text-blue-700 ring-blue-200/50 dark:text-blue-400",
  outline: "bg-transparent text-text-secondary ring-border",
  violet:
    "bg-violet-100 text-violet-800 ring-violet-200/60 dark:bg-violet-950/45 dark:text-violet-200 dark:ring-violet-800/50",
  orange:
    "bg-orange-100 text-orange-800 ring-orange-200/60 dark:bg-orange-950/45 dark:text-orange-200 dark:ring-orange-800/50",
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  dot?: boolean;
  pulse?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export function Badge({
  children,
  variant = "default",
  dot = false,
  pulse = false,
  size = "sm",
  className,
}: BadgeProps) {
  const dotColors: Record<BadgeVariant, string> = {
    default: "bg-stone-400",
    primary: "bg-primary",
    success: "bg-emerald-500",
    warning: "bg-amber-500",
    danger: "bg-red-500",
    info: "bg-blue-500",
    outline: "bg-stone-400",
    violet: "bg-violet-500",
    orange: "bg-orange-500",
  };

  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "inline-flex items-center gap-1.5 font-medium ring-1 ring-inset whitespace-nowrap shrink-0",
        size === "sm" && "px-2 py-0.5 text-[11px] rounded-md",
        size === "md" && "px-2.5 py-1 text-xs rounded-lg",
        variantStyles[variant],
        className
      )}
    >
      {dot && (
        <span className="relative flex h-1.5 w-1.5">
          {pulse && (
            <span
              className={cn(
                "absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping",
                dotColors[variant]
              )}
            />
          )}
          <span className={cn("relative inline-flex rounded-full h-1.5 w-1.5", dotColors[variant])} />
        </span>
      )}
      {children}
    </motion.span>
  );
}
