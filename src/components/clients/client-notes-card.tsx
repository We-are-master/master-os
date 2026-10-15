"use client";

import { CalendarClock } from "lucide-react";
import { parseClientNotes } from "@/lib/client-notes";

/** Notas do cliente na ficha: um bloco por pedido, sem as etiquetas técnicas (15/10/2026). */
export function ClientNotesCard({ notes }: { notes: string | null | undefined }) {
  const blocos = parseClientNotes(notes);
  if (blocos.length === 0) return null;

  return (
    <section aria-label="Notes" className="space-y-2">
      <p className="m-0 text-[12px] font-medium text-text-secondary">Notes</p>
      <div className="space-y-2">
        {blocos.map((b, i) => (
          <article key={i} className="space-y-2 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
            {b.source || b.leadId ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {b.source ? (
                  <span className="inline-flex h-[22px] items-center rounded-md bg-surface-tertiary px-2 text-[11px] font-medium text-text-secondary">
                    {b.source}
                  </span>
                ) : null}
                {b.leadId ? (
                  <span className="text-[11px] tabular-nums text-text-tertiary" title="Checkatrade lead id">
                    Lead {b.leadId}
                  </span>
                ) : null}
              </div>
            ) : null}
            {b.title ? <p className="m-0 text-[13px] font-semibold text-text-primary">{b.title}</p> : null}
            {b.paragraphs.map((t, k) => (
              <p key={k} className="m-0 text-[13px] leading-relaxed text-text-secondary">
                {t}
              </p>
            ))}
            {b.availability ? (
              <p className="m-0 flex items-start gap-1.5 text-[12px] text-text-tertiary">
                <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {b.availability}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
