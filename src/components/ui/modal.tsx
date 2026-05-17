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
            className="absolute inset-0 bg-black/30 dark:bg-black/65 glass"
          />
          <motion.div
            variants={modalTransition}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              "relative w-full min-h-0 h-fit max-h-[min(90dvh,100dvh-2rem)] flex flex-col bg-card rounded-xl shadow-modal border border-fx-line overflow-hidden my-auto",
              sizeStyles[size],
              className
            )}
          >
            <div className="relative flex shrink-0 items-start justify-between gap-3 px-5 py-4 sm:px-6 border-b border-fx-line">
              {/* Coral accent rail (fx-modal__head::before) */}
              <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-fx-coral" aria-hidden />
              <div className="flex min-w-0 flex-1 items-start gap-2.5 pl-1 pr-1">
                {headerLeading ? (
                  <span className="mt-0.5 shrink-0 text-fx-navy dark:text-primary" aria-hidden>
                    {headerLeading}
                  </span>
                ) : null}
                <div className="min-w-0 flex-1">
                  <h2 className="text-[16px] font-semibold text-text-primary leading-tight tracking-[-0.01em]">{title}</h2>
                  {subtitle && (
                    <p className="mt-1 text-xs leading-snug text-fx-mute break-words line-clamp-3" title={subtitle}>
                      {subtitle}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="h-[30px] w-[30px] rounded-md flex items-center justify-center text-fx-mute hover:bg-fx-paper hover:text-text-primary transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* With scrollBody (default), this region scrolls. With scrollBody=false, flex-1 fills space under the header for pinned footers inside children. */}
            <div
              className={cn(
                scrollBody
                  ? "min-h-0 overflow-y-auto overscroll-contain max-h-[min(85vh,calc(90dvh - 5rem),920px)]"
                  : "min-h-0 flex flex-1 flex-col overflow-hidden",
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
