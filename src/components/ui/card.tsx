"use client";

import { cn } from "@/lib/utils";
import { motion, type HTMLMotionProps } from "framer-motion";
import { forwardRef } from "react";

interface CardProps extends HTMLMotionProps<"div"> {
  hover?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
  variant?: "default" | "glass" | "outlined" | "elevated";
}

const paddingStyles = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-8",
};

const variantStyles = {
  default: "bg-card border border-card-border shadow-soft",
  glass: "bg-card border border-card-border shadow-soft",
  outlined: "bg-card border border-border shadow-none",
  elevated: "bg-card border border-card-border shadow-card",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, hover = false, padding = "md", variant = "default", children, ...props }, ref) => {
    return (
      <motion.div
        ref={ref}
        className={cn(
          "rounded-xl transition-colors duration-200",
          variantStyles[variant],
          paddingStyles[padding],
          hover && "cursor-pointer hover:border-[var(--line-2)]",
          className
        )}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

Card.displayName = "Card";

export function CardHeader({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-center justify-between mb-4", className)}>
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <h3 className={cn("text-[14px] font-semibold text-text-primary", className)}>
      {children}
    </h3>
  );
}
