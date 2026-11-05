"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Briefcase,
  Building2,
  CalendarClock,
  Clock,
  Home,
  MapPin,
  PoundSterling,
  Ticket,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STAGE_LABEL, isOpenStage } from "@/lib/crm/etapas";
import { checklistDoJob, prontoParaJob } from "@/lib/crm/pronto-para-job";
import type { Lead, LeadStage } from "@/types/database";
import { BOARD_STAGES, leadValue, type LeadQuote } from "@/services/crm-leads";
import { SEGMENT_LABEL, formatAgo, formatWhen, gbp, isOverdue } from "./crm-ui";

/** Chegou há menos de 15 min: ganha o ponto de "novo". */
const FRESH_MS = 15 * 60 * 1000;

function Line({ icon: Icon, children, title }: { icon: LucideIcon; children: ReactNode; title?: string }) {
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-text-secondary" title={title}>
      <Icon className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
      <span className="truncate">{children}</span>
    </p>
  );
}

function BoardCard({
  lead,
  quote,
  accountName,
  semEntrada,
  now,
  onOpen,
}: {
  lead: Lead;
  quote?: LeadQuote | null;
  accountName?: string | null;
  semEntrada: boolean;
  now: number;
  onOpen: (l: Lead) => void;
}) {
  const stage = lead.stage ?? "new";
  const segment = lead.segment ?? "b2c";
  const value = leadValue(lead, quote);
  const ready = stage === "accepted" ? prontoParaJob(checklistDoJob({ lead, quote, semEntrada })) : null;
  const overdue = isOpenStage(stage) && isOverdue(lead.next_action_at);
  const fresh = now - Date.parse(lead.created_at) < FRESH_MS;
  const address = [lead.address?.trim(), lead.postcode?.trim()].filter(Boolean).join(", ");
  const arrived = new Date(lead.created_at).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
  return (
    <button
      type="button"
      onClick={() => onOpen(lead)}
      className={cn(
        "w-full text-left rounded-lg border bg-card px-3 py-2.5 transition hover:border-border hover:shadow-sm",
        fresh ? "border-primary/40 ring-1 ring-primary/15" : "border-border-light",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-text-primary">
          {fresh ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="Just arrived" />
          ) : (
            <UserRound className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
          )}
          <span className="truncate">{lead.name || "No name"}</span>
        </p>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
            segment === "b2b" ? "bg-[var(--info-bg,#e8f0fe)] text-[var(--info-ink,#1d4ed8)]" : "bg-surface-secondary text-text-secondary",
          )}
        >
          {segment === "b2b" ? <Briefcase className="h-3 w-3" aria-hidden /> : <Home className="h-3 w-3" aria-hidden />}
          {SEGMENT_LABEL[segment]}
        </span>
      </div>

      <div className="mt-1.5 space-y-1">
        {accountName ? <Line icon={Building2}>{accountName}</Line> : null}
        <Line icon={MapPin} title={address || undefined}>
          {address || <span className="text-text-tertiary">No address yet</span>}
        </Line>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-dashed border-border-light pt-1.5">
        <span className="inline-flex items-center gap-1 text-[11px] text-text-tertiary" title={`Arrived ${arrived}`}>
          <Clock className="h-3 w-3" aria-hidden />
          {formatAgo(lead.created_at, now)}
        </span>
        {value ? (
          <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-text-secondary">
            <PoundSterling className="h-3 w-3" aria-hidden />
            {gbp(value).replace("£", "")}
          </span>
        ) : null}
        {lead.next_action_at && isOpenStage(stage) ? (
          <span className={cn("inline-flex items-center gap-1 text-[11px]", overdue ? "text-[var(--bad-ink)]" : "text-text-tertiary")}>
            <CalendarClock className="h-3 w-3" aria-hidden />
            {formatWhen(lead.next_action_at)}
          </span>
        ) : null}
        {lead.external_ref ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-text-tertiary">
            <Ticket className="h-3 w-3" aria-hidden />#{lead.external_ref}
          </span>
        ) : null}
        {ready ? (
          <Badge variant={ready.pronto ? "success" : "warning"} className="text-[10px] px-1.5 py-0">
            {ready.pronto ? "ready" : `${ready.faltam} missing`}
          </Badge>
        ) : null}
      </div>
    </button>
  );
}

export function LeadBoard({
  columns,
  counts,
  quotes,
  accountNames,
  platformAccounts,
  loading,
  onOpen,
}: {
  columns: Record<string, Lead[]>;
  counts: Record<string, number>;
  quotes: Record<string, LeadQuote>;
  accountNames: Record<string, string>;
  platformAccounts: Set<string>;
  loading?: boolean;
  onOpen: (l: Lead) => void;
}) {
  // Relógio do board: "12 min" e o ponto de novo andam sozinhos.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="min-w-0 overflow-x-auto -mx-1 px-1 pb-2">
      <div className="flex gap-3 min-w-max">
        {BOARD_STAGES.map((st: LeadStage) => {
          const rows = columns[st] ?? [];
          const total = counts[st] ?? rows.length;
          return (
            <section key={st} aria-label={STAGE_LABEL[st]} className="w-72 shrink-0 rounded-xl bg-surface-secondary/50 p-2">
              <header className="mb-2 flex items-center justify-between px-1">
                <p className="text-xs font-semibold text-text-secondary">{STAGE_LABEL[st]}</p>
                <span className="text-[11px] tabular-nums text-text-tertiary">{total}</span>
              </header>
              <div className="space-y-1.5">
                {loading && !rows.length ? <p className="px-1 text-[11px] text-text-tertiary">Loading…</p> : null}
                {!loading && !rows.length ? <p className="px-1 text-[11px] text-text-tertiary">No leads</p> : null}
                {rows.map((l) => (
                  <BoardCard
                    key={l.id}
                    lead={l}
                    quote={quotes[l.id]}
                    accountName={l.account_id ? accountNames[l.account_id] : null}
                    now={now}
                    semEntrada={!!l.account_id && platformAccounts.has(l.account_id)}
                    onOpen={onOpen}
                  />
                ))}
                {total > rows.length ? (
                  <p className="px-1 pt-1 text-[11px] text-text-tertiary">+{total - rows.length} more · use List</p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
