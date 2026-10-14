"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { buttonTap } from "@/lib/motion";

type ButtonVariant = "primary" | "secondary" | "subtle" | "ghost" | "danger" | "outline" | "success";
type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon";

/**
 * Fixfy OS UNO (VOS UNO §6). Solid is navy and only for the primary action of a
 * surface; nothing is filled orange. `outline` is the old name of `secondary`;
 * `success` has no place in UNO (a green button is a bug) and renders as primary.
 */
const variantStyles: Record<ButtonVariant, string> = {
  primary: "bg-primary text-[var(--on-brand)] font-semibold hover:bg-primary-hover",
  secondary:
    "bg-card text-text-primary border border-[var(--line-2)] shadow-[0_1px_0_rgba(10,10,31,0.05)] hover:bg-surface-secondary hover:shadow-none",
  outline:
    "bg-card text-text-primary border border-[var(--line-2)] shadow-[0_1px_0_rgba(10,10,31,0.05)] hover:bg-surface-secondary hover:shadow-none",
  subtle: "bg-surface-secondary text-text-secondary border border-border hover:bg-surface-tertiary",
  ghost: "bg-transparent text-text-secondary hover:bg-surface-tertiary hover:text-text-primary",
  danger: "bg-danger text-white font-semibold hover:brightness-90",
  success: "bg-primary text-[var(--on-brand)] font-semibold hover:bg-primary-hover",
};

const sizeStyles: Record<ButtonSize, string> = {
  /** min-h allows multi-line labels on narrow rails (labels wrap instead of overflowing). */
  xs: "min-h-6 px-2 text-[11px] gap-x-1 rounded-lg [&_svg:not(.animate-spin)]:h-3 [&_svg:not(.animate-spin)]:w-3",
  sm: "min-h-[30px] px-3 text-[12px] gap-x-1.5 gap-y-1 rounded-lg [&_svg:not(.animate-spin)]:h-3.5 [&_svg:not(.animate-spin)]:w-3.5",
  md: "min-h-9 px-4 text-[13px] gap-x-1.5 gap-y-1 rounded-lg [&_svg:not(.animate-spin)]:h-3.5 [&_svg:not(.animate-spin)]:w-3.5",
  lg: "min-h-[42px] px-5 text-[13px] gap-x-2 gap-y-1 rounded-lg [&_svg:not(.animate-spin)]:h-3.5 [&_svg:not(.animate-spin)]:w-3.5",
  icon: "h-[30px] w-[30px] shrink-0 rounded-lg [&_svg:not(.animate-spin)]:h-4 [&_svg:not(.animate-spin)]:w-4",
};

interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  title?: string;
  /** Associate a submit button with a form by id when the button is outside the `<form>`. */
  form?: string;
  "aria-label"?: string;
  "aria-pressed"?: boolean | "true" | "false" | "mixed";
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  icon,
  loading,
  children,
  disabled,
  onClick,
  type = "button",
  title,
  form,
  style,
  "aria-label": ariaLabel,
  "aria-pressed": ariaPressed,
}: ButtonProps) {
  return (
    <motion.button
      type={type}
      title={title}
      form={form}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      style={style}
      whileTap={!disabled ? buttonTap : undefined}
      className={cn(
        "inline-flex flex-wrap items-center justify-center font-[550] leading-none transition-colors duration-150 cursor-pointer select-none",
        "focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--accent)]",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      disabled={disabled || loading}
      onClick={onClick}
    >
      {loading && (
        <svg className="h-4 w-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {!loading && icon ? <span className="inline-flex shrink-0">{icon}</span> : null}
      {children != null ? (
        <span className={cn("min-w-0 text-center whitespace-normal leading-tight", icon || loading ? "text-balance" : "")}>{children}</span>
      ) : null}
    </motion.button>
  );
}
