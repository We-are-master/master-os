"use client";

import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { drawerTransition, overlayTransition } from "@/lib/motion";
import { X } from "lucide-react";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** Renders inside the header area below the title row (e.g. owner row). */
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
  /** Renders below the scroll area (e.g. sticky chat input). */
  footer?: React.ReactNode;
  width?: string;
  className?: string;
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  headerExtra,
  children,
  footer,
  width = "w-[440px]",
  className,
}: DrawerProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            variants={overlayTransition}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={onClose}
            className="fixed inset-0 bg-black/20 z-40 glass"
          />
          <motion.div
            variants={drawerTransition}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              "fixed right-0 top-0 bottom-0 max-h-[100dvh] bg-surface border-l border-border shadow-modal z-50 flex flex-col",
              width,
              className
            )}
          >
            {title && (
              <div className="shrink-0 border-b border-border-light">
                <div className="flex items-start justify-between gap-3 px-6 py-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold text-text-primary truncate">{title}</h3>
                    {subtitle && (
                      <p className="text-xs text-text-tertiary mt-0.5 line-clamp-2 break-words">{subtitle}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-text-tertiary hover:bg-surface-tertiary hover:text-text-secondary transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {headerExtra ? <div className="px-6 pb-3">{headerExtra}</div> : null}
              </div>
            )}
            <div className="flex flex-1 flex-col min-h-0">
              <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
              {footer != null ? <div className="shrink-0 border-t border-border-light bg-surface">{footer}</div> : null}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
