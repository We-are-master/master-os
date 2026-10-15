"use client";

import type { ReactNode } from "react";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";

/**
 * Faixa do Pulse (dono, 15/10/2026): um título pequeno e os números lado a lado
 * numa peça só, separados por divisórias. Os KpiCard dentro perdem a moldura
 * própria pelo CSS `.pulse-strip` (globals.css).
 */
export function PulseStrip({
  title,
  hint,
  showTitle = false,
  children,
}: {
  /** Nome para leitores de tela; só aparece com `showTitle` (o dono tirou os títulos em 15/10/2026). */
  title: string;
  hint?: string;
  showTitle?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className={showTitle ? "pulse-strip rounded-xl border border-fx-line bg-card" : "pulse-strip pulse-strip--bare rounded-xl border border-fx-line bg-card"}>
      {showTitle ? (
        <p className="m-0 flex items-center gap-1.5 px-3.5 pt-2.5 text-[11px] font-semibold text-text-tertiary">
          {title}
          {hint ? <FixfyHintIcon text={hint} placement="top-start" /> : null}
        </p>
      ) : null}
      {children}
    </section>
  );
}
