"use client";

import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { modalTransition, overlayTransition } from "@/lib/motion";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Optional icon or element shown left of the title (e.g. Fixfy header pattern). */
  headerLeading?: React.ReactNode;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Applied to the outer fixed full-screen wrapper (e.g. z-index above other overlays). */
  rootClassName?: string;
  scrollBody?: boolean;
}

const sizeStyles = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  headerLeading,
  children,
  size = "md",
  className,
  rootClassName,
  scrollBody = true,
}: ModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <div
          className={cn(
            "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain py-4 sm:items-center sm:py-6 px-3 sm:px-4",
            rootClassName,
          )}
        >
          <motion.div
            variants={overlayTransition}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={onClose}
            className="absolute inset-0 bg-black/30 glass"
          />
          <motion.div
            variants={modalTransition}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              "relative w-full h-fit max-h-[min(90dvh,100dvh-2rem)] flex flex-col bg-card rounded-2xl shadow-modal border border-border-light overflow-hidden my-auto",
              sizeStyles[size],
              className
            )}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4 border-b border-border-light">
              <div className="flex min-w-0 flex-1 items-start gap-2.5 pr-1">
                {headerLeading ? (
                  <span className="mt-0.5 shrink-0 text-[#020040]" aria-hidden>
                    {headerLeading}
                  </span>
                ) : null}
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold text-text-primary leading-snug">{title}</h2>
                  {subtitle && (
                    <p className="mt-0.5 truncate text-xs leading-snug text-text-tertiary" title={subtitle}>
                      {subtitle}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="h-8 w-8 rounded-lg flex items-center justify-center text-text-tertiary hover:bg-surface-tertiary hover:text-text-secondary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* No flex-1 here: it stretches the scroll region and leaves empty space below short content. */}
            <div
              className={cn(
                scrollBody
                  ? "min-h-0 overflow-y-auto overscroll-contain max-h-[min(85vh,calc(90dvh - 5rem),920px)]"
                  : "min-h-0 overflow-hidden",
              )}
            >
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
