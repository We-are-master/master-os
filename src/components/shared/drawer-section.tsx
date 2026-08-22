"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A section inside a drawer that stays shut until asked for.
 *
 * This is what replaced the tabs that were empty most of the time. A tab you
 * open and find empty in eight accounts out of ten teaches you to stop opening
 * tabs at all — including the ones that do hold something. As a row, the
 * heading carries its own summary ("2 custom prices", "No portal users yet"),
 * so the answer is usually there without opening anything.
 */
/**
 * Sections stack into one list, not a stack of floating cards.
 *
 * Four rounded cards with gaps between them read as four unrelated objects and
 * waste a strip of drawer width on each side. As one bordered list with hairline
 * dividers, they read as what they are: the rest of this record, in order.
 */
export function DrawerSectionList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("divide-y divide-border-light overflow-hidden rounded-xl border border-border-light bg-card", className)}>
      {children}
    </div>
  );
}

export function DrawerSection({
  title,
  summary,
  defaultOpen = false,
  children,
  className,
}: {
  title: string;
  /** One line telling the reader what is inside, before they open it. */
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-hover"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-primary">{title}</span>
          {summary ? (
            <span className="mt-0.5 block truncate text-[12px] leading-snug text-text-tertiary">{summary}</span>
          ) : null}
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-text-tertiary transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open ? <div className="border-t border-border-light bg-surface-hover/30 px-4 py-3.5">{children}</div> : null}
    </div>
  );
}

/**
 * One fact: label above, value below. Drawers used to set these side by side,
 * which made a long label push its own value off the edge.
 */
export function DrawerField({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">{label}</p>
      <div className="mt-0.5 text-[13px] font-medium text-text-primary break-words">{value}</div>
    </div>
  );
}

/**
 * The action bar every drawer ends with.
 *
 * Before this, one drawer had a footer, another left "Deactivate" floating in
 * the middle of the profile, and a third scattered Edit buttons across three
 * rows. Same shape everywhere now: what destroys sits far left, what saves sits
 * far right, and neither ever moves.
 */
export function DrawerFooter({
  destructive,
  children,
  className,
}: {
  /** Archive / deactivate / delete — kept away from the confirming hand. */
  destructive?: ReactNode;
  /** Cancel and the primary action, in that order. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 px-5 py-3", className)}>
      <div className="min-w-0">{destructive}</div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * The numbers row at the top of a drawer: same tile, same order of weight
 * (value first, label under it), whatever the drawer is about.
 */
export function DrawerStats({
  items,
  className,
}: {
  items: { label: string; value: ReactNode; hint?: string }[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={cn("grid gap-2", items.length >= 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3", className)}>
      {items.map((it) => (
        <div key={it.label} className="rounded-xl border border-border-light bg-surface-hover/40 px-3 py-2.5">
          <p className="text-[15px] font-semibold leading-tight tabular-nums text-text-primary">{it.value}</p>
          <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">{it.label}</p>
          {it.hint ? <p className="mt-0.5 truncate text-[10px] text-text-tertiary">{it.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}
