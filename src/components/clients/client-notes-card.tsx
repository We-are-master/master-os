"use client";

import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseClientNotes, type ClientNoteBlock } from "@/lib/client-notes";

/**
 * Notas do cliente como timeline (15/10/2026), no desenho da timeline do job card:
 * bolinha e linha à esquerda, título e data na mesma linha, texto embaixo. Cada pedido
 * do Checkatrade é um item, do mais novo para o mais antigo (a data sai do id do lead).
 */

function quando(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
  });
}

function ordenar(blocos: ClientNoteBlock[]): ClientNoteBlock[] {
  // Mais novo primeiro; sem data (nota à mão) fica na ordem em que foi escrita, depois dos datados.
  return blocos
    .map((b, i) => ({ b, i }))
    .sort((x, y) => {
      if (x.b.at && y.b.at) return y.b.at.localeCompare(x.b.at);
      if (x.b.at) return -1;
      if (y.b.at) return 1;
      return x.i - y.i;
    })
    .map((x) => x.b);
}

export function ClientNotesCard({ notes }: { notes: string | null | undefined }) {
  const blocos = ordenar(parseClientNotes(notes));
  if (blocos.length === 0) return null;

  return (
    <ol className="m-0 list-none p-0">
      {blocos.map((b, i) => {
        const ultimo = i === blocos.length - 1;
        const data = quando(b.at);
        const titulo = b.title ?? (b.source ? "Enquiry" : "Note");
        return (
          <li key={i} className={cn("relative flex gap-3.5", ultimo ? "" : "pb-5")}>
            <span
              className={cn(
                "relative z-[1] mt-1 h-[11px] w-[11px] shrink-0 rounded-full border-2",
                b.source ? "border-fx-coral bg-fx-coral" : "border-fx-line-strong bg-card",
              )}
              aria-hidden="true"
            />
            {!ultimo ? <span className="absolute bottom-0 left-[5px] top-4 w-px bg-fx-line" aria-hidden="true" /> : null}
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-start justify-between gap-3">
                <p className="m-0 text-[13px] font-semibold text-text-primary">{titulo}</p>
                {data ? <span className="shrink-0 text-[11px] tabular-nums text-text-tertiary">{data}</span> : null}
              </div>
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
            </div>
          </li>
        );
      })}
    </ol>
  );
}
