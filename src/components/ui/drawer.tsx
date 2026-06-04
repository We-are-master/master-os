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
  /** Renders beside the title (e.g. Zendesk ticket badge). */
  titleAddon?: React.ReactNode;
  /** Renders inside the header area below the title row (e.g. owner row). */
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
  /** Renders below the scroll area (e.g. sticky chat input). */
  footer?: React.ReactNode;
  /** Applied to the fixed footer wrapper (padding, tint). */
  footerClassName?: string;
  width?: string;
  className?: string;
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  titleAddon,
  headerExtra,
  children,
  footer,
  footerClassName,
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
            className="fixed inset-0 bg-black/20 dark:bg-black/60 z-40 glass"
          />
          <motion.div
            variants={drawerTransition}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              "fixed right-0 top-0 bottom-0 max-h-[100dvh] bg-surface border-l border-fx-line shadow-modal z-50 flex flex-col",
              width,
              className
            )}
          >
            {title && (
              <div className="shrink-0 border-b border-fx-line sticky top-0 bg-surface z-[2]">
                <div className="flex items-start justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <h3 className="text-[15px] font-semibold text-text-primary truncate tracking-[-0.005em] min-w-0">
                        {title}
                      </h3>
                      {titleAddon ? <span className="shrink-0">{titleAddon}</span> : null}
                    </div>
                    {subtitle && (
                      <p className="text-xs text-fx-mute mt-0.5 line-clamp-2 break-words">{subtitle}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-[30px] w-[30px] shrink-0 rounded-md flex items-center justify-center text-fx-mute hover:bg-fx-paper hover:text-text-primary transition-colors"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {headerExtra ? <div className="px-5 pb-3">{headerExtra}</div> : null}
              </div>
            )}
            <div className="flex flex-1 flex-col min-h-0">
              <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
              {footer != null ? (
                <div
                  className={cn(
                    "shrink-0 border-t border-fx-line bg-fx-paper sticky bottom-0",
                    footerClassName,
                  )}
                >
                  {footer}
                </div>
              ) : null}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
