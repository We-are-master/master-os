"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

type BadgeVariant = "default" | "primary" | "success" | "warning" | "danger" | "info" | "outline";

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-stone-100 text-stone-700 ring-stone-200/50",
  primary: "bg-primary-light text-primary ring-primary/10",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200/50",
  warning: "bg-amber-50 text-amber-700 ring-amber-200/50",
  danger: "bg-red-50 text-red-700 ring-red-200/50",
  info: "bg-blue-50 text-blue-700 ring-blue-200/50",
  outline: "bg-transparent text-stone-600 ring-stone-300",
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
  };

  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "inline-flex items-center gap-1.5 font-medium ring-1 ring-inset",
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
