"use client";

/**
 * O ⋯ no topo do drawer do lead (06/11/2026, dono): o que é raro fica aqui,
 * fora do caminho. Delete pede confirmação (quem chama já confirma).
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, MoreHorizontal, Trash2, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export function LeadActionsMenu({
  published,
  onTogglePublish,
  onDelete,
  busy,
}: {
  published: boolean;
  onTogglePublish: () => void;
  onDelete: () => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const fora = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const item = "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-surface-secondary disabled:opacity-50";

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        aria-expanded={open}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition hover:bg-surface-secondary hover:text-text-primary",
          open && "bg-surface-secondary text-text-primary",
        )}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
      </button>
      {open ? (
        <div className="absolute right-0 top-9 z-20 w-52 rounded-xl border border-border-light bg-surface p-1 shadow-lg">
          <button
            type="button"
            className={cn(item, "text-text-primary")}
            disabled={busy}
            onClick={() => {
              setOpen(false);
              onTogglePublish();
            }}
          >
            <Users className="h-4 w-4 text-text-tertiary" />
            {published ? "Unpublish from partners" : "Publish to partners"}
          </button>
          <button
            type="button"
            className={cn(item, "text-danger")}
            disabled={busy}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trash2 className="h-4 w-4" />
            Delete lead
          </button>
        </div>
      ) : null}
    </div>
  );
}
