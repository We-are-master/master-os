"use client";

import { cn } from "@/lib/utils";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/motion";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Ignored since Fixfy OS UNO: no eyebrow above page titles. Kept so call sites compile. */
  eyebrow?: string;
  /** Replaces the subtitle with an inline `!` icon next to the title that reveals the text on hover/focus. */
  infoTooltip?: string;
  /** Fica colado ao título, na mesma linha (ex.: seletor B2C/B2B, resumo curto). */
  titleAddon?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

/**
 * The view head of Fixfy OS UNO (VOS UNO §11): h1 on the left, actions on the
 * right, same line, min-height 38 and 10px to the first card. The subtitle is
 * not shown as a paragraph: it goes in the hint next to the title.
 */
export function PageHeader({ title, subtitle, infoTooltip, titleAddon, children, className }: PageHeaderProps) {
  const hint = infoTooltip ?? subtitle;
  return (
    <motion.div
      variants={fadeInUp}
      initial="hidden"
      animate="visible"
      className={cn("uno-view-head flex min-h-[38px] items-center justify-between gap-4 flex-wrap", className)}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="m-0 font-display text-[20px] font-semibold leading-[1.3] tracking-[-0.02em] text-text-primary">
            {title}
          </h1>
          {hint ? <FixfyHintIcon text={hint} /> : null}
        </div>
        {titleAddon}
      </div>
      {children && (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 shrink-0">{children}</div>
      )}
    </motion.div>
  );
}

/**
 * Segunda linha do topo da página (VOS UNO): visão, busca e filtros, sempre
 * 10px abaixo do PageHeader e com controles de 30px. Ações ficam no PageHeader.
 */
export function PageToolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("uno-view-toolbar flex min-h-[30px] shrink-0 flex-wrap items-center gap-2", className)}>
      {children}
    </div>
  );
}
