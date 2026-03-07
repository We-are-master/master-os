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

interface KpiCardProps {
  title: string;
  value: string | number;
  format?: "currency" | "number" | "percent" | "none";
  change?: number;
  changeLabel?: string;
  icon?: LucideIcon;
  iconColor?: string;
  accent?: "primary" | "emerald" | "blue" | "amber" | "purple";
  description?: string;
  className?: string;
}

const accentStyles = {
  primary: "bg-primary/5 text-primary",
  emerald: "bg-emerald-50 text-emerald-600",
  blue: "bg-blue-50 text-blue-600",
  amber: "bg-amber-50 text-amber-600",
  purple: "bg-purple-50 text-purple-600",
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
    <motion.div variants={staggerItem}>
      <Card className={cn("relative overflow-hidden group", className)}>
        <div className="flex items-start justify-between">
          <div className="space-y-2 flex-1 min-w-0">
            <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">
              {title}
            </p>
            <p className="text-2xl font-bold text-text-primary tracking-tight">
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
            {description && (
              <p className="text-xs text-text-tertiary">{description}</p>
            )}
          </div>
          {Icon && (
            <div
              className={cn(
                "h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110",
                accentStyles[accent]
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
          )}
        </div>
        <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-surface-hover/50 pointer-events-none" />
      </Card>
    </motion.div>
  );
}
