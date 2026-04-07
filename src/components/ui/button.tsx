"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { buttonTap } from "@/lib/motion";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-hover shadow-sm shadow-primary/20 hover:shadow-md hover:shadow-primary/25",
  secondary:
    "bg-stone-900 text-white hover:bg-stone-800 shadow-sm dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200",
  ghost:
    "bg-transparent text-text-secondary hover:bg-surface-tertiary hover:text-text-primary",
  danger:
    "bg-red-600 text-white hover:bg-red-700 shadow-sm",
  outline:
    "bg-card text-text-primary border border-border hover:bg-surface-tertiary hover:border-border shadow-sm",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-9 px-4 text-sm gap-2 rounded-lg",
  lg: "h-11 px-6 text-sm gap-2 rounded-xl",
  icon: "h-9 w-9 rounded-lg",
};

interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
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
      whileTap={!disabled ? buttonTap : undefined}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-all duration-200 cursor-pointer select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      disabled={disabled || loading}
      onClick={onClick}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {!loading && icon}
      {children}
    </motion.button>
  );
}
