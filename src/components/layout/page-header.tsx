"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Replaces the subtitle with an inline `!` icon next to the title that reveals the text on hover/focus. */
  infoTooltip?: string;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, infoTooltip, children, className }: PageHeaderProps) {
  return (
    <motion.div
      variants={fadeInUp}
      initial="hidden"
      animate="visible"
      className={cn("flex items-center justify-between", className)}
    >
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">{title}</h1>
          {infoTooltip ? (
            <span className="group relative inline-flex">
              <span
                tabIndex={0}
                aria-label={infoTooltip}
                className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[11px] font-bold leading-none cursor-help outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
                style={{ background: "#F1F1F3", color: "#6B6B70" }}
              >
                !
              </span>
              <span
                role="tooltip"
                className="pointer-events-none invisible absolute top-full left-0 z-[60] mt-1 w-64 whitespace-pre-wrap rounded bg-[#1a1a1a] px-2 py-1.5 text-[11px] leading-snug text-white opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
              >
                {infoTooltip}
              </span>
            </span>
          ) : null}
        </div>
        {subtitle && !infoTooltip ? (
          <p className="text-sm text-text-secondary mt-0.5">{subtitle}</p>
        ) : null}
      </div>
      {children && (
        <div className="flex min-w-0 flex-nowrap items-center justify-end gap-2 shrink-0">{children}</div>
      )}
    </motion.div>
  );
}
