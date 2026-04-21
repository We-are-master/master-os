"use client";

import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { Card } from "./card";
import { motion } from "framer-motion";
import { staggerItem } from "@/lib/motion";
import {
  TrendingUp,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";

interface KpiCardProps {
  title: string;
  value: string | number;
  format?: "currency" | "number" | "percent" | "none";
  change?: number;
  changeLabel?: string;
  icon?: LucideIcon;
  iconColor?: string;
  accent?: "primary" | "emerald" | "blue" | "amber" | "purple" | "stone";
  description?: string;
  /** When true, render the description as a hover `!` tooltip next to the title instead of a body line. */
  descriptionAsTooltip?: boolean;
  /** Tighter padding + smaller type — use in dense layouts like the Live Map header row. */
  compact?: boolean;
  className?: string;
}

const accentStyles = {
  primary: "bg-primary/5 text-primary",
  emerald: "bg-emerald-50 text-emerald-600",
  blue: "bg-blue-50 text-blue-600",
  amber: "bg-amber-50 text-amber-600",
  purple: "bg-purple-50 text-purple-600",
  stone: "bg-stone-100 text-stone-600 dark:bg-stone-900/50 dark:text-stone-400",
};

export function KpiCard({
  title,
  value,
  format = "none",
  change,
  changeLabel,
  icon: Icon,
  accent = "primary",
  description,
  descriptionAsTooltip = false,
  compact = false,
  className,
}: KpiCardProps) {
  const formattedValue = (() => {
    if (typeof value === "string") return value;
    switch (format) {
      case "currency": return formatCurrency(value);
      case "number": return formatNumber(value);
      case "percent": return `${value}%`;
      default: return String(value);
    }
  })();

  const isPositive = change !== undefined && change >= 0;

  return (
    <motion.div variants={staggerItem} className="h-full min-w-0 w-full">
      <Card
        padding={compact ? "none" : "md"}
        className={cn(
          "relative overflow-hidden group h-full flex flex-col",
          compact && "px-3 py-2.5",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-2 flex-1 min-h-0">
          <div className={cn("flex-1 min-w-0", compact ? "space-y-0.5" : "space-y-2")}>
            <div className="flex items-center gap-1.5">
              <p
                className={cn(
                  "font-medium text-text-secondary uppercase tracking-wide",
                  compact ? "text-[10px]" : "text-xs",
                )}
              >
                {title}
              </p>
              {descriptionAsTooltip && description ? (
                <FixfyHintIcon text={description} />
              ) : null}
            </div>
            <p
              className={cn(
                "font-bold text-text-primary tracking-tight",
                compact ? "text-lg" : "text-2xl",
              )}
            >
              {formattedValue}
            </p>
            {change !== undefined && (
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 text-xs font-semibold",
                    isPositive ? "text-emerald-600" : "text-red-500"
                  )}
                >
                  {isPositive ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {isPositive ? "+" : ""}
                  {change}%
                </span>
                {changeLabel && (
                  <span className="text-xs text-text-tertiary">{changeLabel}</span>
                )}
              </div>
            )}
            {description && !descriptionAsTooltip ? (
              <p className={cn("text-text-tertiary line-clamp-2", compact ? "text-[10px]" : "text-xs")}>
                {description}
              </p>
            ) : null}
          </div>
          {Icon && (
            <div
              className={cn(
                "rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110",
                compact ? "h-8 w-8 rounded-lg" : "h-10 w-10",
                accentStyles[accent],
              )}
            >
              <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} />
            </div>
          )}
        </div>
        <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-surface-hover/50 pointer-events-none" />
      </Card>
    </motion.div>
  );
}
