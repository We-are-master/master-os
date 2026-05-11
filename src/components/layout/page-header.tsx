"use client";

import { cn } from "@/lib/utils";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Mono micro-label rendered above the title (uppercase, tracked). */
  eyebrow?: string;
  /** Replaces the subtitle with an inline `!` icon next to the title that reveals the text on hover/focus. */
  infoTooltip?: string;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, eyebrow, infoTooltip, children, className }: PageHeaderProps) {
  return (
    <motion.div
      variants={fadeInUp}
      initial="hidden"
      animate="visible"
      className={cn("flex items-end justify-between gap-6 flex-wrap", className)}
    >
      <div className="flex flex-col gap-1 min-w-0">
        {eyebrow && <span className="fx-kk">{eyebrow}</span>}
        <div className="flex items-center gap-2">
          <h1 className="text-[26px] font-semibold tracking-[-0.015em] leading-[1.2] text-text-primary m-0">
            {title}
          </h1>
          {infoTooltip ? <FixfyHintIcon text={infoTooltip} /> : null}
        </div>
        {subtitle && !infoTooltip ? (
          <p className="text-[13px] text-fx-mute m-0">{subtitle}</p>
        ) : null}
      </div>
      {children && (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 shrink-0">{children}</div>
      )}
    </motion.div>
  );
}
