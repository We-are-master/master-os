"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Toolbar primitives for list pages (Quotes, Jobs, and every tab after them).
 *
 * The rule these encode: the toolbar is icons. A page header carries one
 * labelled button (the primary action) and everything else — refresh, export,
 * KPIs, search — is an icon that opens up only when it is being used.
 */

/** Icon-only action. The label is the tooltip and the accessible name. */
export function ToolbarIconButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  spinning = false,
  disabled = false,
  className,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  /** Renders as pressed — for toggles like "show KPIs". */
  active?: boolean;
  spinning?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors",
        active
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-card text-text-secondary hover:bg-surface-hover hover:text-text-primary",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", spinning && "animate-spin")} />
    </button>
  );
}

/**
 * Search that lives as an icon until it is needed. Clicking expands it and
 * focuses the field; it collapses again on blur, but only while empty, so an
 * active search never disappears from the toolbar without the user clearing it.
 */
export function ExpandingSearch({
  value,
  onChange,
  placeholder = "Search…",
  expandedWidthClass = "w-52",
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  expandedWidthClass?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const expanded = open || value.trim().length > 0;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!expanded) {
    return (
      <ToolbarIconButton icon={Search} label={placeholder} onClick={() => setOpen(true)} className={className} />
    );
  }

  return (
    <div
      className={cn(
        "relative inline-flex h-8 items-center transition-[width] duration-200",
        expandedWidthClass,
        className,
      )}
    >
      <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-text-tertiary" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (!value.trim()) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          onChange("");
          setOpen(false);
        }}
        aria-label={placeholder}
        className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-7 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-primary/40 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange("");
            setOpen(false);
          }}
          className="absolute right-1.5 inline-flex h-5 w-5 items-center justify-center rounded text-text-tertiary hover:text-text-primary"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}
