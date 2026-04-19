"use client";

import { cn } from "@/lib/utils";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
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
          {infoTooltip ? <FixfyHintIcon text={infoTooltip} /> : null}
        </div>
        {subtitle && !infoTooltip ? (
          <p className="text-sm text-text-secondary mt-0.5">{subtitle}</p>
        ) : null}
      </div>
      {children && (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 shrink-0">{children}</div>
      )}
    </motion.div>
  );
}
