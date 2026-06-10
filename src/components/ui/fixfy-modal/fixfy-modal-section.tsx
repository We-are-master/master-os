"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  title: string;
  badge?: "required" | "optional";
  children: ReactNode;
  className?: string;
};

export function FixfyModalSection({ id, title, badge, children, className }: Props) {
  return (
    <section
      data-modal-section={id}
      className={cn("scroll-mt-2 space-y-3", className)}
    >
      <div className="flex items-baseline gap-2">
        <h4 className="text-[15px] font-bold text-text-primary m-0">{title}</h4>
        {badge === "required" ? (
          <span className="ml-auto text-xs text-text-tertiary">Required</span>
        ) : badge === "optional" ? (
          <span className="ml-auto text-xs text-text-tertiary/80">Optional</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}
