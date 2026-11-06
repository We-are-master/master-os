"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Briefcase,
  Building2,
  CalendarClock,
  Clock,
  FileText,
  Home,
  MapPin,
  PoundSterling,
  RotateCcw,
  Send,
  UserRound,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ZendeskTicketLink } from "@/components/ui/zendesk-ticket-link";
import { cn } from "@/lib/utils";
import { LOST_REASON_LABEL, STAGE_LABEL, isOpenStage } from "@/lib/crm/etapas";
import { checklistDoJob, prontoParaJob } from "@/lib/crm/pronto-para-job";
import type { Lead, LeadStage } from "@/types/database";
import { BOARD_STAGES, leadValue, type LeadQuote } from "@/services/crm-leads";
import { QUOTE_STATUS_CHIP, SEGMENT_LABEL, formatAgo, formatWhen, gbp, isOverdue } from "./crm-ui";

/** Cor de cada etapa: faixa da coluna, ponto, contador e borda do card. */
const STAGE_TONE: Record<
  LeadStage,
  { bar: string; col: string; dot: string; pill: string; edge: string }
> = {
  new: {
    bar: "bg-sky-500",
    col: "bg-sky-50/70 dark:bg-sky-950/25",
    dot: "bg-sky-500",
    pill: "bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200",
    edge: "border-l-sky-500",
  },
  qualifying: {
    bar: "bg-violet-500",
    col: "bg-violet-50/70 dark:bg-violet-950/25",
    dot: "bg-violet-500",
    pill: "bg-violet-100 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200",
    edge: "border-l-violet-500",
  },
  qualified: {
    bar: "bg-cyan-500",
    col: "bg-cyan-50/70 dark:bg-cyan-950/25",
    dot: "bg-cyan-500",
    pill: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/60 dark:text-cyan-200",
    edge: "border-l-cyan-500",
  },
  quoting: {
    bar: "bg-amber-500",
    col: "bg-amber-50/70 dark:bg-amber-950/25",
    dot: "bg-amber-500",
    pill: "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200",
    edge: "border-l-amber-500",
  },
  quoted: {
    bar: "bg-indigo-500",
    col: "bg-indigo-50/70 dark:bg-indigo-950/25",
    dot: "bg-indigo-500",
    pill: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200",
    edge: "border-l-indigo-500",
  },
  won: {
    bar: "bg-emerald-500",
    col: "bg-emerald-50/70 dark:bg-emerald-950/25",
    dot: "bg-emerald-500",
    pill: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200",
    edge: "border-l-emerald-500",
  },
  lost: {
    bar: "bg-rose-500",
    col: "bg-rose-50/70 dark:bg-rose-950/25",
    dot: "bg-rose-500",
    pill: "bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200",
    edge: "border-l-rose-500",
  },
};

/** Chegou há menos de 15 min: ganha o ponto de "novo". */
const FRESH_MS = 15 * 60 * 1000;

function Line({
  icon: Icon,
  children,
  title,
  tone,
}: {
  icon: LucideIcon;
  children: ReactNode;
  title?: string;
  tone: string;
}) {
  return (
    <p
      className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-text-secondary"
      title={title}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", tone)} aria-hidden />
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
  dragging,
  onDragState,
  onOpen,
}: {
  lead: Lead;
  quote?: LeadQuote | null;
  accountName?: string | null;
  semEntrada: boolean;
  now: number;
  dragging: boolean;
  onDragState: (id: string | null) => void;
  onOpen: (l: Lead) => void;
}) {
  const stage = lead.stage ?? "new";
  const segment = lead.segment ?? "b2c";
  const value = leadValue(lead, quote);
  const ready =
    quote?.status === "awaiting_payment"
      ? prontoParaJob(checklistDoJob({ lead, quote, semEntrada }))
      : null;
  const chip = quote && (stage === "quoting" || stage === "quoted") ? QUOTE_STATUS_CHIP[quote.status] : null;
  const readyToSend = quote?.status === "quote_ready";
  const overdue = isOpenStage(stage) && isOverdue(lead.next_action_at);
  const fresh = now - Date.parse(lead.created_at) < FRESH_MS;
  const street = lead.address?.trim() ?? "";
  const pc = lead.postcode?.trim() ?? "";
  const address =
    pc &&
    street
      .toUpperCase()
      .replace(/\s/g, "")
      .includes(pc.toUpperCase().replace(/\s/g, ""))
      ? street
      : [street, pc].filter(Boolean).join(", ");
  const arrived = new Date(lead.created_at).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={stage !== "won"}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/lead-id", lead.id);
        e.dataTransfer.effectAllowed = "move";
        onDragState(lead.id);
      }}
      onDragEnd={() => onDragState(null)}
      onClick={() => onOpen(lead)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(lead);
        }
      }}
      className={cn(
        "w-full cursor-pointer active:cursor-grabbing text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 border bg-card px-3 py-2.5 transition hover:border-border hover:shadow-sm",
        "border-l-[3px]",
        STAGE_TONE[stage].edge,
        readyToSend
          ? "border-y-emerald-300 border-r-emerald-300 shadow-[0_0_0_3px_rgb(16_185_129/0.15)]"
          : fresh
            ? "border-y-sky-300 border-r-sky-300 shadow-[0_0_0_3px_rgb(14_165_233/0.12)]"
            : "border-y-border-light border-r-border-light",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-text-primary">
          {fresh ? (
            <span
              className="relative flex h-2 w-2 shrink-0"
              aria-label="Just arrived"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
            </span>
          ) : (
            <UserRound
              className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400"
              aria-hidden
            />
          )}
          <span className="truncate">{lead.name || "No name"}</span>
        </p>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
            segment === "b2b"
              ? "bg-violet-100 text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-900/50 dark:text-violet-200 dark:ring-violet-800"
              : "bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200 dark:bg-teal-900/40 dark:text-teal-200 dark:ring-teal-800",
          )}
        >
          {segment === "b2b" ? (
            <Briefcase className="h-3 w-3" aria-hidden />
          ) : (
            <Home className="h-3 w-3" aria-hidden />
          )}
          {SEGMENT_LABEL[segment]}
        </span>
      </div>

      <div className="mt-1.5 space-y-1">
        {accountName ? (
          <Line icon={Building2} tone="text-indigo-500">
            <span className="font-medium text-text-primary">{accountName}</span>
          </Line>
        ) : null}
        <Line icon={MapPin} tone="text-rose-500" title={address || undefined}>
          {address || (
            <span className="text-text-tertiary">No address yet</span>
          )}
        </Line>
      </div>

      {chip || (stage === "lost" && lead.lost_reason) ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {chip ? (
            <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold", chip.cls)}>
              {readyToSend ? <Send className="h-3 w-3" aria-hidden /> : <FileText className="h-3 w-3" aria-hidden />}
              {chip.label}
              {quote?.reference ? <span className="font-normal opacity-75">· {quote.reference}</span> : null}
            </span>
          ) : null}
          {stage === "lost" && lead.lost_reason ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[10.5px] font-medium text-rose-700 dark:bg-rose-900/40 dark:text-rose-200">
              <XCircle className="h-3 w-3" aria-hidden />
              {LOST_REASON_LABEL[lead.lost_reason]}
            </span>
          ) : null}
          {stage === "lost" && lead.nurture_until ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-teal-50 px-1.5 py-0.5 text-[10.5px] font-medium text-teal-700 dark:bg-teal-900/40 dark:text-teal-200">
              <RotateCcw className="h-3 w-3" aria-hidden />
              back {lead.nurture_until.slice(8, 10)}/{lead.nurture_until.slice(5, 7)}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-dashed border-border-light pt-1.5">
        <ZendeskTicketLink
          className="order-last ml-auto"
          ticketId={
            lead.external_source === "zendesk" || !lead.external_source
              ? lead.external_ref
              : null
          }
          fallbackQuery={lead.email || lead.phone}
        />
        <span
          className="inline-flex items-center gap-1 text-[11px] text-text-secondary"
          title={`Arrived ${arrived}`}
        >
          <Clock className="h-3 w-3 text-amber-500" aria-hidden />
          {formatAgo(lead.created_at, now)}
        </span>
        {value ? (
          <span className="inline-flex items-center gap-0.5 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
            <PoundSterling className="h-3 w-3" aria-hidden />
            {gbp(value).replace("£", "")}
          </span>
        ) : null}
        {lead.next_action_at && isOpenStage(stage) ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[11px]",
              overdue ? "font-semibold text-rose-600" : "text-text-secondary",
            )}
          >
            <CalendarClock
              className={cn(
                "h-3 w-3",
                overdue ? "text-rose-500" : "text-violet-500",
              )}
              aria-hidden
            />
            {formatWhen(lead.next_action_at)}
          </span>
        ) : null}
        {ready ? (
          <Badge
            variant={ready.pronto ? "success" : "warning"}
            className="text-[10px] px-1.5 py-0"
          >
            {ready.pronto ? "ready" : `${ready.faltam} missing`}
          </Badge>
        ) : null}
      </div>
    </div>
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
  onMove,
}: {
  columns: Record<string, Lead[]>;
  counts: Record<string, number>;
  quotes: Record<string, LeadQuote>;
  accountNames: Record<string, string>;
  platformAccounts: Set<string>;
  loading?: boolean;
  onOpen: (l: Lead) => void;
  /** Card solto numa coluna: quem decide o que acontece é a tela (modal, quote, aviso). */
  onMove: (l: Lead, to: LeadStage) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<LeadStage | null>(null);
  const findLead = (id: string) => Object.values(columns).flat().find((l) => l.id === id) ?? null;
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
          const total = st === "lost" ? (counts.lost_week ?? rows.length) : (counts[st] ?? rows.length);
          const dragFrom = dragId ? findLead(dragId)?.stage : null;
          return (
            <section
              key={st}
              aria-label={STAGE_LABEL[st]}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overStage !== st) setOverStage(st);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverStage((cur) => (cur === st ? null : cur));
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/lead-id") || dragId;
                setOverStage(null);
                setDragId(null);
                const lead = id ? findLead(id) : null;
                if (lead && (lead.stage ?? "new") !== st) onMove(lead, st);
              }}
              className={cn(
                "w-72 shrink-0 overflow-hidden rounded-xl transition",
                STAGE_TONE[st].col,
                overStage === st && dragFrom !== st && "ring-2 ring-offset-2 ring-primary/50",
              )}
            >
              <div className={cn("h-1", STAGE_TONE[st].bar)} aria-hidden />
              <div className="p-2">
                <header className="mb-2 flex items-center justify-between px-1">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
                    <span
                      className={cn("h-2 w-2 rounded-full", STAGE_TONE[st].dot)}
                      aria-hidden
                    />
                    {STAGE_LABEL[st]}
                    {st === "lost" ? <span className="font-normal text-text-tertiary">· last 7 days</span> : null}
                  </p>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                      STAGE_TONE[st].pill,
                    )}
                  >
                    {total}
                  </span>
                </header>
                <div className="space-y-1.5">
                  {loading && !rows.length ? (
                    <p className="px-1 text-[11px] text-text-tertiary">
                      Loading…
                    </p>
                  ) : null}
                  {!loading && !rows.length ? (
                    <p className="px-1 text-[11px] text-text-tertiary">
                      No leads
                    </p>
                  ) : null}
                  {rows.map((l) => (
                    <BoardCard
                      key={l.id}
                      lead={l}
                      quote={quotes[l.id]}
                      accountName={
                        l.account_id ? accountNames[l.account_id] : null
                      }
                      now={now}
                      dragging={dragId === l.id}
                      onDragState={setDragId}
                      semEntrada={
                        !!l.account_id && platformAccounts.has(l.account_id)
                      }
                      onOpen={onOpen}
                    />
                  ))}
                  {total > rows.length ? (
                    <p className="px-1 pt-1 text-[11px] text-text-tertiary">
                      +{total - rows.length} more · use List
                    </p>
                  ) : null}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
