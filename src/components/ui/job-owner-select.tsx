"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import type { AssignableUser } from "@/services/profiles";

const roleLabels: Record<string, string> = {
  admin: "Admin",
  manager: "Manager",
  operator: "Operator",
};

interface JobOwnerSelectProps {
  value: string | undefined | null;
  /** When `value` is set but not in `users` (e.g. legacy row), show this name in the trigger. */
  fallbackName?: string | null;
  users: AssignableUser[];
  disabled?: boolean;
  emptyLabel?: string;
  onChange: (ownerId: string | undefined) => void | Promise<void>;
  className?: string;
}

export function JobOwnerSelect({
  value,
  fallbackName,
  users,
  disabled,
  emptyLabel = "No owner",
  onChange,
  className,
}: JobOwnerSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = value ? users.find((u) => u.id === value) : undefined;
  const triggerName = selected?.full_name ?? (value && fallbackName ? fallbackName : null);
  const triggerInactive = selected && selected.is_active === false;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const handlePick = useCallback(
    async (id: string | undefined) => {
      setOpen(false);
      await onChange(id);
    },
    [onChange]
  );

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={cn(
          "w-full flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm",
          "shadow-sm transition-all duration-200",
          "hover:border-primary/25 hover:bg-surface-hover/80",
          "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/35",
          disabled && "opacity-60 pointer-events-none",
          open && "ring-2 ring-primary/15 border-primary/30"
        )}
      >
        {triggerName ? (
          <>
            <Avatar name={triggerName} size="sm" className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-text-primary truncate">{triggerName}</p>
              {triggerInactive && (
                <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wide">Inactive</p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-hover border border-border-light">
              <UserX className="h-4 w-4 text-text-tertiary" />
            </div>
            <span className="flex-1 text-text-tertiary">{emptyLabel}</span>
          </>
        )}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-tertiary transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1.5 w-full min-w-[240px] max-h-72 overflow-y-auto rounded-xl border border-border bg-card py-1 shadow-xl ring-1 ring-black/5 dark:ring-white/10"
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            type="button"
            onClick={() => handlePick(undefined)}
            className={cn(
              "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors",
              "hover:bg-surface-hover",
              !value && "bg-primary/5"
            )}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-hover border border-border-light">
              <UserX className="h-3.5 w-3.5 text-text-tertiary" />
            </div>
            <span className="flex-1 font-medium text-text-secondary">{emptyLabel}</span>
            {!value && <Check className="h-4 w-4 shrink-0 text-primary" />}
          </button>
          <div className="mx-2 h-px bg-border-light" />
          {users.map((u) => {
            const isSel = value === u.id;
            const inactive = u.is_active === false;
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => handlePick(u.id)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors",
                  "hover:bg-surface-hover",
                  isSel && "bg-primary/8"
                )}
              >
                <Avatar name={u.full_name} size="sm" className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-text-primary truncate">{u.full_name}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                    {u.role && (
                      <span className="text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                        {roleLabels[u.role] ?? u.role}
                      </span>
                    )}
                    {inactive && (
                      <span className="rounded-md bg-amber-500/15 px-1.5 py-px text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                        Inactive
                      </span>
                    )}
                  </div>
                </div>
                {isSel && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
