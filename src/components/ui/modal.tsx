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
  children: React.ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
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
  children,
  size = "md",
  className,
  scrollBody = true,
}: ModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
              "relative w-full bg-card rounded-2xl shadow-modal border border-border-light overflow-hidden",
              sizeStyles[size],
              className
            )}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
              <div>
                <h2 className="text-base font-semibold text-text-primary">{title}</h2>
                {subtitle && <p className="text-xs text-text-tertiary mt-0.5">{subtitle}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="h-8 w-8 rounded-lg flex items-center justify-center text-text-tertiary hover:bg-surface-tertiary hover:text-text-secondary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className={cn(scrollBody ? "max-h-[70vh] overflow-y-auto" : "overflow-visible")}>
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
