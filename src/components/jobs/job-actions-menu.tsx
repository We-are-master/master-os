"use client";

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { ChevronRight, MoreVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type IconType = ComponentType<{ className?: string }>;

export type JobActionItem = {
  key: string;
  label: string;
  icon: IconType;
  onSelect: () => void;
  hint?: string;
  disabled?: boolean;
  /** Motivo do bloqueio; aparece como tooltip quando `disabled`. */
  title?: string;
  danger?: boolean;
};

export type JobActionGroup = {
  key: string;
  label: string;
  icon: IconType;
  items: JobActionItem[];
};

/**
 * Menu "⋯" do job card: um nível por assunto (cliente, parceiro, agenda, job)
 * e o submenu com as ações. Grupo sem item visível não aparece.
 */
export function JobActionsMenu({
  groups,
  trigger,
  placement = "down",
}: {
  groups: JobActionGroup[];
  trigger?: ReactNode;
  /** "up" para quando o botão mora num rodapé (gaveta, modal). */
  placement?: "down" | "up";
}) {
  const [open, setOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const visibleGroups = groups.filter((g) => g.items.length > 0);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setActiveGroup(null);
  }, [open]);

  const run = (item: JobActionItem) => {
    if (item.disabled) return;
    setOpen(false);
    item.onSelect();
  };

  return (
    <div className="relative" ref={rootRef}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Job actions"
        aria-pressed={open}
        className={cn("h-8 px-2.5 text-xs", open && "bg-surface-hover")}
        icon={<MoreVertical className="h-3.5 w-3.5" />}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger ?? "Actions"}
      </Button>

      {open ? (
        <div
          role="menu"
          className={cn("absolute right-0 z-50 w-56 rounded-xl border border-border-light bg-card p-1 shadow-lg dark:border-border", placement === "up" ? "bottom-full mb-1" : "top-full mt-1")}
        >
          {visibleGroups.map((group) => {
            const isActive = activeGroup === group.key;
            const GroupIcon = group.icon;
            return (
              <div
                key={group.key}
                className="relative"
                onMouseEnter={() => setActiveGroup(group.key)}
              >
                <button
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={isActive}
                  onClick={() => setActiveGroup(isActive ? null : group.key)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft" || e.key === "ArrowRight") setActiveGroup(group.key);
                  }}
                  className={cn(
                    "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-medium text-text-primary hover:bg-surface-hover",
                    isActive && "bg-surface-hover",
                  )}
                >
                  <GroupIcon className="h-4 w-4 shrink-0 text-text-secondary" />
                  <span className="flex-1">{group.label}</span>
                  <span className="text-[11px] tabular-nums text-text-tertiary">{group.items.length}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                </button>

                {isActive ? (
                  <div
                    role="menu"
                    aria-label={group.label}
                    className={cn("absolute right-full z-50 mr-1 w-64 rounded-xl border border-border-light bg-card p-1 shadow-lg max-sm:static max-sm:mr-0 max-sm:mt-1 max-sm:w-full dark:border-border", placement === "up" ? "bottom-0" : "top-0")}
                  >
                    <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-text-tertiary">{group.label}</p>
                    {group.items.map((item) => {
                      const ItemIcon = item.icon;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          role="menuitem"
                          disabled={item.disabled}
                          title={item.disabled ? item.title : undefined}
                          onClick={() => run(item)}
                          className={cn(
                            "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45",
                            item.danger ? "text-red-600 hover:bg-red-500/10 dark:text-red-400" : "text-text-primary",
                          )}
                        >
                          <ItemIcon className="mt-0.5 h-4 w-4 shrink-0 opacity-80" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-medium leading-snug">{item.label}</span>
                            {item.hint ? (
                              <span className="block text-[11px] leading-snug text-text-tertiary">{item.hint}</span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
