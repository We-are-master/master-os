"use client";

import type { ReactNode } from "react";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";

/**
 * Faixa do Pulse (dono, 15/10/2026): um título pequeno e os números lado a lado
 * numa peça só, separados por divisórias. Os KpiCard dentro perdem a moldura
 * própria pelo CSS `.pulse-strip` (globals.css).
 */
export function PulseStrip({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="pulse-strip rounded-xl border border-fx-line bg-card">
      <p className="m-0 flex items-center gap-1.5 px-3.5 pt-2.5 text-[11px] font-semibold text-text-tertiary">
        {title}
        {hint ? <FixfyHintIcon text={hint} placement="top-start" /> : null}
      </p>
      {children}
    </section>
  );
}
