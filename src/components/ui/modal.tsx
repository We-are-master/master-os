"use client";

import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { modalTransition, overlayTransition } from "@/lib/motion";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { FixfyModalTopSteps, type FixfyModalStep } from "@/components/ui/fixfy-modal";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Optional icon or element shown left of the title (e.g. Fixfy header pattern). */
  headerLeading?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "compact";
  className?: string;
  /** Applied to the outer fixed full-screen wrapper (e.g. z-index above other overlays). */
  rootClassName?: string;
  scrollBody?: boolean;
  /** Pinned footer bar below scrollable body (wizard modals). */
  footer?: ReactNode;
  /** Horizontal stepper below header (wizard modals). */
  topSteps?: FixfyModalStep[];
  activeStep?: string;
  onStepClick?: (id: string) => void;
  /** Wizard: header + optional steps + scroll body + optional footer in a fixed-height grid. */
  layout?: "default" | "wizard";
}

const sizeStyles = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  compact: "max-w-[600px]",
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
  footer,
  topSteps,
  activeStep,
  onStepClick,
  layout = "default",
}: ModalProps) {
  const isWizard = layout === "wizard";
  const effectiveScrollBody = isWizard ? false : scrollBody;

  /** After the native file picker closes, a stray click often hits the overlay — ignore briefly. */
  const suppressOverlayCloseUntilRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const onWindowFocus = () => {
      suppressOverlayCloseUntilRef.current = Date.now() + 500;
    };
    window.addEventListener("focus", onWindowFocus);
    return () => window.removeEventListener("focus", onWindowFocus);
  }, [open]);

  const handleOverlayClose = () => {
    if (Date.now() < suppressOverlayCloseUntilRef.current) return;
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <div
          className={cn(
            "fixed inset-0 z-50 flex justify-center px-3 sm:px-4 py-4 sm:py-6",
            effectiveScrollBody
              ? "items-start overflow-y-auto overscroll-contain sm:items-center"
              : "items-center overflow-hidden overscroll-contain",
            rootClassName,
          )}
        >
          <motion.div
            variants={overlayTransition}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={handleOverlayClose}
            className="absolute inset-0 bg-black/30 dark:bg-black/65 glass"
          />
          <motion.div
            variants={modalTransition}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "relative w-full min-h-0 flex flex-col max-h-[min(90dvh,100dvh-2rem)] bg-card rounded-xl shadow-modal border border-fx-line overflow-hidden my-auto",
              effectiveScrollBody ? "h-fit" : "h-[min(90dvh,100dvh-2rem)] min-h-0",
              sizeStyles[size],
              className,
            )}
          >
            <div className="relative flex shrink-0 items-start justify-between gap-3 border-b border-fx-line px-[22px] py-4 sm:pl-[26px] sm:pr-[22px]">
              <span className="absolute left-0 top-0 bottom-0 w-[4px] bg-fx-coral" aria-hidden />
              <div className="flex min-w-0 flex-1 items-start gap-2.5 pl-0.5 pr-1">
                {headerLeading ? (
                  <span className="mt-0.5 shrink-0 text-fx-navy dark:text-primary" aria-hidden>
                    {headerLeading}
                  </span>
                ) : null}
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-extrabold text-text-primary leading-tight tracking-[-0.02em]">
                    {title}
                  </h2>
                  {subtitle ? (
                    <p
                      className="mt-0.5 text-[13px] leading-snug text-text-secondary break-words line-clamp-3"
                      title={subtitle}
                    >
                      {subtitle}
                    </p>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="ml-auto flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] border-none bg-surface-hover text-text-secondary transition-colors hover:bg-border hover:text-text-primary"
                aria-label="Close"
              >
                <X className="h-[18px] w-[18px]" />
              </button>
            </div>

            {topSteps && topSteps.length > 0 ? (
              <FixfyModalTopSteps
                steps={topSteps}
                activeId={activeStep ?? topSteps[0]!.id}
                onStepClick={onStepClick}
              />
            ) : null}

            <div
              className={cn(
                isWizard
                  ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                  : effectiveScrollBody
                    ? "min-h-0 overflow-y-auto overscroll-contain max-h-[min(85vh,calc(90dvh - 5rem),920px)]"
                    : "flex h-full min-h-0 flex-1 flex-col overflow-hidden",
              )}
            >
              {children}
            </div>

            {footer ? <div className="shrink-0">{footer}</div> : null}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
