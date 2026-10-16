"use client";

import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { modalTransition, overlayTransition } from "@/lib/motion";
import { X } from "lucide-react";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { FixfyModalTopSteps, type FixfyModalStep } from "@/components/ui/fixfy-modal";

interface ModalProps {
  /** Opt-in focus containment for contextual help dialogs. */
  manageFocus?: boolean;
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
  // VOS UNO dialog widths: sm 440 · md 560 · ml 600 · lg 760.
  sm: "max-w-[440px]",
  md: "max-w-[560px]",
  lg: "max-w-[760px]",
  compact: "max-w-[600px]",
};

export function Modal({
  manageFocus = false,
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open || !manageFocus) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') ?? []);
    (focusable()[0] ?? dialog)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first) { event.preventDefault(); dialog?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previous?.focus();
    };
  }, [open, manageFocus, onClose]);

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
            className="absolute inset-0 bg-[rgba(10,10,31,0.36)] dark:bg-black/55"
          />
          <motion.div
            ref={dialogRef}
            role={manageFocus ? "dialog" : undefined}
            aria-modal={manageFocus ? true : undefined}
            aria-labelledby={manageFocus ? titleId : undefined}
            tabIndex={manageFocus ? -1 : undefined}
            variants={modalTransition}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "relative w-full min-h-0 flex flex-col max-h-[min(88dvh,100dvh-2rem)] bg-card rounded-2xl shadow-modal border border-[var(--line-soft)] overflow-hidden my-auto",
              effectiveScrollBody ? "h-fit" : "h-[min(90dvh,100dvh-2rem)] min-h-0",
              sizeStyles[size],
              className,
            )}
          >
            {/* VOS UNO title bar: 36px, 4% ink wash, hairline, 13/600 title, 24px close. No accent line, no eyebrow. */}
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--line-soft)] bg-[color-mix(in_srgb,var(--text-primary)_4%,var(--card-bg))] pl-4 pr-2">
              {headerLeading ? (
                <span className="flex shrink-0 text-text-secondary [&_svg]:h-4 [&_svg]:w-4" aria-hidden>
                  {headerLeading}
                </span>
              ) : null}
              <h2 id={titleId} className="m-0 min-w-0 truncate text-[13px] font-semibold text-text-primary">{title}</h2>
              {subtitle ? <FixfyHintIcon text={subtitle} /> : null}
              <button
                type="button"
                onClick={onClose}
                className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
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
                "uno-modal-body",
                isWizard
                  ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                  : effectiveScrollBody
                    // Sem `max-h` aqui de propósito. A que existia,
                    // `max-h-[min(85vh,calc(90dvh - 5rem),920px)]`, tinha
                    // espaços literais dentro do arbitrary value: o atributo
                    // `class` quebra no espaço e o Tailwind nunca gerou a
                    // regra. Era letra morta, e ligá-la agora mudaria o
                    // recorte de 42 modais de uma vez. O painel já é
                    // `flex flex-col` com `max-h`, e isto aqui já encolhe e
                    // rola sozinho.
                    ? "min-h-0 overflow-y-auto overscroll-contain"
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
