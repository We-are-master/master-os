"use client";

import { Children, isValidElement } from "react";
import { Check, Clock, Send, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

/**
 * Marcador de estado do VOS UNO (§9): estado nunca só por cor. ✓ concluído/pago,
 * relógio aguardando/vence, ✕ falhou/vencido/cancelado, seta de envio enviado/info.
 * Rótulo neutro (tipo, categoria) não leva marcador.
 */
const STATE_MARKER: Partial<Record<BadgeVariant, LucideIcon>> = {
  success: Check,
  warning: Clock,
  orange: Clock,
  danger: X,
  info: Send,
};

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

/**
 * Fixfy OS UNO chip (VOS UNO §9): 11/500, padding 2×8, radius 6, no border,
 * solid state fill. Colour is for STATE only; categories stay neutral grey.
 */
const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-surface-tertiary text-text-primary",
  primary: "bg-[var(--pick-bg)] text-text-primary font-semibold shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--text-primary)_22%,transparent)]",
  success: "bg-success-light text-[var(--ok-ink)]",
  warning: "bg-warning-light text-[var(--warn-ink)]",
  danger: "bg-danger-light text-[var(--bad-ink)]",
  info: "bg-info-light text-[var(--info-ink)]",
  outline: "bg-surface-tertiary text-text-primary",
  violet: "bg-surface-tertiary text-text-primary",
  orange: "bg-warning-light text-[var(--warn-ink)]",
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  dot?: boolean;
  pulse?: boolean;
  size?: "sm" | "md";
  className?: string;
  /** false tira o marcador de estado (ex.: contagem dentro de chip). */
  marker?: boolean;
}

export function Badge({
  children,
  variant = "default",
  dot = false,
  pulse = false,
  size = "sm",
  className,
  marker = true,
}: BadgeProps) {
  const dotColors: Record<BadgeVariant, string> = {
    default: "bg-text-tertiary",
    primary: "bg-text-primary",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    info: "bg-info",
    outline: "bg-text-tertiary",
    violet: "bg-text-tertiary",
    orange: "bg-warning",
  };

  return (
    <motion.span
      className={cn(
        "inline-flex items-center gap-[5px] font-medium leading-[1.45] whitespace-nowrap shrink-0 rounded-[6px] text-[11px] [&_svg]:h-3 [&_svg]:w-3",
        size === "sm" && "px-2 py-[2px]",
        size === "md" && "px-2.5 py-[3px]",
        variantStyles[variant],
        className
      )}
    >
      {(() => {
        // Chip que já traz o próprio ícone não ganha outro.
        const hasOwnIcon = Children.toArray(children).some((c) => isValidElement(c) && typeof c.type !== "string");
        const Marker = STATE_MARKER[variant];
        if (!marker || pulse || hasOwnIcon || !Marker) return null;
        return <Marker className="shrink-0" strokeWidth={2.2} aria-hidden />;
      })()}
      {dot && (pulse || !STATE_MARKER[variant] || !marker) && variant !== "default" && variant !== "outline" && variant !== "violet" && (
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
