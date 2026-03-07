"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface ProgressProps {
  value: number;
  max?: number;
  size?: "sm" | "md" | "lg";
  color?: "primary" | "emerald" | "blue" | "amber" | "red";
  showValue?: boolean;
  label?: string;
  className?: string;
}

const colorStyles = {
  primary: "bg-primary",
  emerald: "bg-emerald-500",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

const sizeStyles = {
  sm: "h-1",
  md: "h-1.5",
  lg: "h-2",
};

export function Progress({
  value,
  max = 100,
  size = "md",
  color = "primary",
  showValue = false,
  label,
  className,
}: ProgressProps) {
  const percentage = Math.min(100, (value / max) * 100);

  return (
    <div className={cn("space-y-1.5", className)}>
      {(label || showValue) && (
        <div className="flex items-center justify-between">
          {label && <span className="text-xs text-text-secondary">{label}</span>}
          {showValue && <span className="text-xs font-semibold text-text-primary">{Math.round(percentage)}%</span>}
        </div>
      )}
      <div className={cn("w-full bg-stone-100 rounded-full overflow-hidden", sizeStyles[size])}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.2 }}
          className={cn("h-full rounded-full", colorStyles[color])}
        />
      </div>
    </div>
  );
}
