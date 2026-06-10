"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type FixfyModalStep = {
  id: string;
  label: string;
  done?: boolean;
};

type Props = {
  steps: FixfyModalStep[];
  activeId: string;
  onStepClick?: (id: string) => void;
};

export function FixfyModalTopSteps({ steps, activeId, onStepClick }: Props) {
  return (
    <div className="shrink-0 border-b border-border-light bg-surface-hover/40 px-4 py-2.5">
      <div className="flex justify-center overflow-x-auto scrollbar-thin">
        <div className="flex gap-1.5">
      {steps.map((step) => {
        const active = step.id === activeId;
        const done = step.done;
        return (
          <button
            key={step.id}
            type="button"
            onClick={() => onStepClick?.(step.id)}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-lg border-none px-2.5 py-1.5 text-xs font-semibold transition-colors",
              active
                ? "bg-card text-text-primary shadow-sm"
                : "bg-transparent text-text-secondary hover:bg-card/80 hover:text-text-primary",
            )}
          >
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold",
                done
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : active
                    ? "border-primary text-primary bg-card"
                    : "border-border bg-card text-text-tertiary",
              )}
            >
              {done ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
            </span>
            {step.label}
          </button>
        );
      })}
        </div>
      </div>
    </div>
  );
}
