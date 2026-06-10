"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  leading?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function FixfyModalFooter({ leading, children, className }: Props) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-2 border-t border-border-light bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5",
        className,
      )}
    >
      {leading ? <div className="text-[13px] text-text-secondary shrink-0">{leading}</div> : null}
      <div className="flex items-center justify-end gap-2 min-w-0 sm:ml-auto">{children}</div>
    </div>
  );
}
