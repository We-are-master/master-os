"use client";

import { ExternalLink, Search, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";

const SUB = process.env.NEXT_PUBLIC_ZENDESK_SUBDOMAIN || "fixfy";

export function zendeskTicketHref(id: string | number): string {
  return `https://${SUB}.zendesk.com/agent/tickets/${id}`;
}

export function zendeskSearchHref(query: string): string {
  return `https://${SUB}.zendesk.com/agent/search/1?type=ticket&q=${encodeURIComponent(query)}`;
}

/**
 * Chip do ticket do Zendesk, abre em outra aba. Serve para card de lead e de
 * job: com ticket mostra "#48213"; sem ticket e com e-mail ou telefone, vira
 * "Find in Zendesk" (busca pelo contato). Para o clique não abrir o card.
 */
export function ZendeskTicketLink({
  ticketId,
  fallbackQuery,
  className,
  compact,
}: {
  ticketId?: string | number | null;
  fallbackQuery?: string | null;
  className?: string;
  /** Card estreito: sem ticket vira só a lupa, sem o texto. */
  compact?: boolean;
}) {
  const id = ticketId != null && String(ticketId).trim() ? String(ticketId).trim() : null;
  const query = fallbackQuery?.trim() || null;
  if (!id && !query) return null;
  const href = id ? zendeskTicketHref(id) : zendeskSearchHref(query!);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      title={id ? `Open ticket #${id} in Zendesk` : `Search Zendesk for ${query}`}
      className={cn(
        "group inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors",
        id
          ? "bg-[#03363d]/[0.07] text-[#03363d] hover:bg-[#03363d]/15 dark:bg-white/10 dark:text-white/85"
          : "text-text-tertiary hover:bg-surface-secondary hover:text-text-secondary",
        className,
      )}
    >
      {id ? <Ticket className="h-3 w-3" aria-hidden /> : <Search className="h-3 w-3" aria-hidden />}
      {id ? `#${id}` : compact ? null : "Find in Zendesk"}
      {compact && !id ? null : <ExternalLink className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-70" aria-hidden />}
    </a>
  );
}
