"use client";

import { useEffect, useState } from "react";
import { Pencil, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "master-os-dashboard-title-overrides";
const CHANGE_EVENT = "master-os-title-overrides-changed";

/**
 * Read all persisted title overrides from localStorage.
 * Safe to call during render — returns {} on any parsing issue.
 */
function readOverrides(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeOverrides(next: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private-mode errors
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * React hook so every EditableTitle on the page re-renders when any one of
 * them saves a change. Uses a custom window event so we don't need a context.
 */
export function useTitleOverrides() {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  useEffect(() => {
    // Initial hydration from localStorage — only accessible on the client, so
    // running inside the effect is necessary (not a render-time read).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOverrides(readOverrides());
    const handler = () => setOverrides(readOverrides());
    window.addEventListener(CHANGE_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(CHANGE_EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);
  return overrides;
}

export interface EditableTitleProps {
  /** Stable id used as the localStorage key for this specific heading. */
  id: string;
  /** Base/default title if no override is set. Also shown in the "reset" tooltip. */
  defaultValue: string;
  className?: string;
  /** Extra classes on the wrapping span. Useful when the parent has flex rules. */
  wrapperClassName?: string;
}

/**
 * A label that the user can click to rename inline. The pencil appears on
 * hover/focus; Enter commits, Escape cancels, blur commits. A tiny "reset"
 * arrow shows up when a custom title is active so they can revert.
 *
 * Storage is localStorage only (per-browser) — no backend writes, so this
 * doesn't need migrations or API routes. If we want cross-device sync later,
 * swap readOverrides/writeOverrides for a Supabase call.
 */
export function EditableTitle({
  id,
  defaultValue,
  className,
  wrapperClassName,
}: EditableTitleProps) {
  const overrides = useTitleOverrides();
  const current = overrides[id] ?? defaultValue;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const startEdit = () => {
    setDraft(current);
    setEditing(true);
  };

  const commit = () => {
    const trimmed = draft.trim();
    const next = readOverrides();
    if (!trimmed || trimmed === defaultValue) {
      delete next[id];
    } else {
      next[id] = trimmed;
    }
    writeOverrides(next);
    setEditing(false);
  };

  const reset = () => {
    const next = readOverrides();
    delete next[id];
    writeOverrides(next);
  };

  if (editing) {
    return (
      <span className={cn("inline-flex items-center gap-1", wrapperClassName)}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          className={cn(
            "rounded-md border border-primary/40 bg-card px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary/25",
            className,
          )}
        />
      </span>
    );
  }

  const isCustom = overrides[id] != null && overrides[id] !== defaultValue;
  return (
    <span className={cn("group inline-flex items-center gap-1.5", wrapperClassName)}>
      <span className={className}>{current}</span>
      <button
        type="button"
        onClick={startEdit}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-tertiary hover:text-text-primary transition-opacity"
        title={`Rename (default: ${defaultValue})`}
        aria-label="Rename"
      >
        <Pencil className="h-3 w-3" />
      </button>
      {isCustom ? (
        <button
          type="button"
          onClick={reset}
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-tertiary hover:text-text-primary transition-opacity"
          title={`Reset to "${defaultValue}"`}
          aria-label="Reset to default"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}
