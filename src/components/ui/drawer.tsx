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
  children: React.ReactNode;
  width?: string;
  className?: string;
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
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
              "fixed right-0 top-0 bottom-0 bg-white border-l border-stone-200 shadow-modal z-50 flex flex-col",
              width,
              className
            )}
          >
            {title && (
              <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
                <div>
                  <h3 className="text-base font-semibold text-text-primary">{title}</h3>
                  {subtitle && <p className="text-xs text-text-tertiary mt-0.5">{subtitle}</p>}
                </div>
                <button
                  onClick={onClose}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-stone-400 hover:bg-stone-100 hover:text-stone-600 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
