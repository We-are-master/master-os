"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Briefcase,
  Building2,
  CalendarClock,
  Clock,
  FileText,
  Home,
  Mail,
  Phone,
  MapPin,
  Pencil,
  PoundSterling,
  Check,
  RotateCcw,
  Send,
  Trash2,
  UserRound,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ZendeskTicketLink } from "@/components/ui/zendesk-ticket-link";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { LOST_REASON_LABEL, STAGE_LABEL as DEFAULT_LABEL, STAGE_LABEL_MAX, isOpenStage } from "@/lib/crm/etapas";
import { renameStage, useStageLabels } from "./use-stage-labels";
import { checklistDoJob, prontoParaJob } from "@/lib/crm/pronto-para-job";
import type { Lead, LeadStage } from "@/types/database";
import { BOARD_STAGES, leadValue, type LeadQuote } from "@/services/crm-leads";
import { QUOTE_STATUS_CHIP, SEGMENT_LABEL, formatAgo, formatWhen, gbp, isOverdue } from "./crm-ui";

/**
 * Board nas cores do OS (Fixfy UNO): colunas neutras, navy como cor da marca.
 * Cor só onde significa algo: verde = pronto, âmbar = esperando, vermelho =
 * atrasado ou perdido, coral = acabou de chegar.
 */
const COLUMN = {
  col: "bg-surface-secondary",
  dot: "bg-primary",
  pill: "bg-card text-text-secondary ring-1 ring-inset ring-border-light",
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

/** Linha do card que copia ao clicar (telefone, e-mail, endereço): não abre o card. */
function CopyLine({ icon: Icon, value, label }: { icon: LucideIcon; value: string; label: string }) {
  return (
    <button
      type="button"
      draggable={false}
      title={`Copy ${label}`}
      aria-label={`Copy ${label}: ${value}`}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard
          .writeText(value)
          .then(() => toast.success(`${label.charAt(0).toUpperCase()}${label.slice(1)} copied`))
          .catch(() => toast.error("Could not copy"));
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className="-mx-1 flex w-[calc(100%+0.5rem)] min-w-0 items-center gap-1.5 rounded px-1 text-left text-[11.5px] text-text-secondary transition hover:bg-surface-secondary hover:text-text-primary"
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-text-tertiary" aria-hidden />
      <span className="truncate">{value}</span>
    </button>
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
  onLose,
  onDelete,
  stageLabel,
  selected = false,
  selecting = false,
  onToggleSelect,
}: {
  lead: Lead;
  stageLabel: string;
  /** Marcado para ação em grupo. */
  selected?: boolean;
  /** Já tem card marcado no board: clicar marca em vez de abrir. */
  selecting?: boolean;
  onToggleSelect?: (l: Lead) => void;
  onLose?: (l: Lead) => void;
  /** Tira o card do CRM (some do board; dá para desfazer pelo banco). */
  onDelete?: (l: Lead) => void;
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
      onClick={(e) => {
        if (onToggleSelect && (selecting || e.metaKey || e.ctrlKey || e.shiftKey)) return onToggleSelect(lead);
        onOpen(lead);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (onToggleSelect && selecting) return onToggleSelect(lead);
          onOpen(lead);
        }
      }}
      aria-pressed={onToggleSelect ? selected : undefined}
      className={cn(
        "group/card relative w-full cursor-pointer active:cursor-grabbing text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 border bg-card px-3 py-2.5 transition hover:border-border hover:shadow-sm",
        selected
          ? "border-primary ring-2 ring-primary/30"
          : readyToSend
          ? "border-success ring-2 ring-success/15"
          : fresh
            ? "border-fx-coral ring-2 ring-fx-coral/15"
            : "border-border-light",
        dragging && "opacity-40",
      )}
    >
      {onToggleSelect ? (
        <button
          type="button"
          draggable={false}
          role="checkbox"
          aria-checked={selected}
          aria-label={`Select ${lead.name || "lead"}`}
          title={selected ? "Unselect" : "Select for bulk actions"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(lead);
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className={cn(
            "absolute -top-2 left-2.5 z-10 inline-flex h-4 items-center gap-1 rounded-full border px-1.5 text-[10px] font-semibold leading-none transition",
            selected
              ? "border-primary bg-primary text-white"
              : cn(
                  "border-border bg-card text-text-secondary hover:border-primary hover:text-primary",
                  selecting ? "opacity-100" : "opacity-0 focus:opacity-100 group-hover/card:opacity-100",
                ),
          )}
        >
          <Check className="h-2.5 w-2.5" aria-hidden />
          {selected ? "Selected" : "Select"}
        </button>
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-text-primary">
          {fresh ? (
            <span
              className="relative flex h-2 w-2 shrink-0"
              aria-label="Just arrived"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fx-coral opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-fx-coral" />
            </span>
          ) : (
            <UserRound
              className="h-3.5 w-3.5 shrink-0 text-text-tertiary"
              aria-hidden
            />
          )}
          <span className="truncate">{lead.name || "No name"}</span>
        </p>
        <span className="flex shrink-0 items-center gap-1">
        {onLose && isOpenStage(stage) ? (
          <button
            type="button"
            draggable={false}
            onClick={(e) => {
              e.stopPropagation();
              onLose(lead);
            }}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label={`Move ${lead.name || "lead"} to Lost`}
            title="Out of the pipeline: move to Lost (no reply, price…)"
            className="inline-flex h-5 items-center gap-0.5 rounded-md px-1 text-[10px] font-semibold text-text-tertiary opacity-0 transition hover:bg-danger-light hover:text-danger focus:opacity-100 group-hover/card:opacity-100"
          >
            <XCircle className="h-3 w-3" aria-hidden />
            Lost
          </button>
        ) : null}
        {onDelete ? (
          <button
            type="button"
            draggable={false}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(lead);
            }}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label={`Delete ${lead.name || "lead"}`}
            title="Delete this card"
            className="inline-flex h-5 w-5 items-center justify-center rounded-md text-text-tertiary opacity-0 transition hover:bg-danger-light hover:text-danger focus:opacity-100 group-hover/card:opacity-100"
          >
            <Trash2 className="h-3 w-3" aria-hidden />
          </button>
        ) : null}
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
            segment === "b2b"
              ? "bg-primary text-white"
              : "bg-card text-text-secondary ring-1 ring-inset ring-border-light",
          )}
        >
          {segment === "b2b" ? (
            <Briefcase className="h-3 w-3" aria-hidden />
          ) : (
            <Home className="h-3 w-3" aria-hidden />
          )}
          {SEGMENT_LABEL[segment]}
        </span>
        </span>
      </div>

      <div className="mt-1.5 space-y-1">
        {accountName ? (
          <Line icon={Building2} tone="text-text-tertiary">
            <span className="font-medium text-text-primary">{accountName}</span>
          </Line>
        ) : null}
        {address ? (
          <CopyLine icon={MapPin} value={address} label="address" />
        ) : (
          <Line icon={MapPin} tone="text-text-tertiary">
            <span className="text-text-tertiary">No address yet</span>
          </Line>
        )}
        {lead.phone?.trim() ? <CopyLine icon={Phone} value={lead.phone.trim()} label="phone" /> : null}
        {lead.email?.trim() ? <CopyLine icon={Mail} value={lead.email.trim()} label="email" /> : null}
      </div>

      <div className="mt-2 flex flex-nowrap items-center gap-x-2.5 border-t border-dashed border-border-light pt-1.5">
        <span
          className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-text-secondary"
          title={`Arrived ${arrived}`}
        >
          <Clock className="h-3 w-3 text-text-tertiary" aria-hidden />
          {formatAgo(lead.created_at, now)}
        </span>
        {value ? (
          <span className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[11px] font-semibold tabular-nums text-text-primary">
            <PoundSterling className="h-3 w-3" aria-hidden />
            {gbp(value).replace("£", "")}
          </span>
        ) : null}
        {lead.next_action_at && isOpenStage(stage) ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px]",
              overdue ? "font-semibold text-danger" : "text-text-secondary",
            )}
          >
            <CalendarClock
              className={cn(
                "h-3 w-3",
                overdue ? "text-danger" : "text-text-tertiary",
              )}
              aria-hidden
            />
            {formatWhen(lead.next_action_at)}
          </span>
        ) : null}
        <span className="order-last ml-auto flex min-w-0 flex-nowrap items-center justify-end gap-1.5">
          {/* Com a etiqueta da quote, a da etapa sai: a coluna já diz a etapa. */}
          {chip ? null : (
            <span
              className="inline-flex min-w-0 items-center gap-1 rounded-md bg-primary-light px-1.5 py-0.5 text-[10.5px] font-semibold text-primary"
              title={stageLabel}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
              <span className="truncate">{stageLabel}</span>
            </span>
          )}
          {chip ? (
            <span
              className={cn("inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold", chip.cls)}
              title={quote?.reference ? `${chip.label} · ${quote.reference}` : chip.label}
            >
              {readyToSend ? <Send className="h-3 w-3 shrink-0" aria-hidden /> : <FileText className="h-3 w-3 shrink-0" aria-hidden />}
              <span className="truncate">{chip.label}</span>
            </span>
          ) : null}
          {stage === "lost" && lead.lost_reason ? (
            <span
              className="inline-flex min-w-0 items-center gap-1 rounded-md bg-danger-light px-1.5 py-0.5 text-[10.5px] font-medium text-danger"
              title={LOST_REASON_LABEL[lead.lost_reason]}
            >
              <XCircle className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{LOST_REASON_LABEL[lead.lost_reason]}</span>
            </span>
          ) : null}
          {stage === "lost" && lead.nurture_until ? (
            <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-surface-tertiary px-1.5 py-0.5 text-[10.5px] font-medium text-text-secondary">
              <RotateCcw className="h-3 w-3" aria-hidden />
              back {lead.nurture_until.slice(8, 10)}/{lead.nurture_until.slice(5, 7)}
            </span>
          ) : null}
        <span className="shrink-0">
        <ZendeskTicketLink
          compact
          iconOnly
          ticketId={
            lead.external_source === "zendesk" || !lead.external_source
              ? lead.external_ref
              : null
          }
          fallbackQuery={lead.email || lead.phone}
        />
        </span>
        </span>
        {ready ? (
          <Badge
            variant={ready.pronto ? "success" : "warning"}
            className="shrink-0 whitespace-nowrap text-[10px] px-1.5 py-0"
          >
            {ready.pronto ? "ready" : `${ready.faltam} missing`}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

/** Nome da coluna; admin clica no lápis, digita e Enter grava (vazio = padrão). */
function ColumnTitle({
  stage,
  label,
  dot,
  canRename,
  suffix,
}: {
  stage: LeadStage;
  label: string;
  dot: string;
  canRename: boolean;
  suffix: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const [saving, setSaving] = useState(false);
  const done = useRef(false);

  const start = () => {
    done.current = false;
    setDraft(label);
    setEditing(true);
  };
  const finish = async (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const name = draft.trim();
    if (!save || name === label) return setEditing(false);
    setSaving(true);
    try {
      const next = await renameStage(stage, name);
      toast.success(name ? `Column renamed to ${next[stage]}` : `Column back to ${DEFAULT_LABEL[stage]}`);
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not rename the column");
      done.current = false;
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} aria-hidden />
        <input
          autoFocus
          value={draft}
          maxLength={STAGE_LABEL_MAX}
          disabled={saving}
          aria-label={`Rename ${label}`}
          placeholder={DEFAULT_LABEL[stage]}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void finish(true);
            if (e.key === "Escape") void finish(false);
          }}
          onBlur={() => void finish(true)}
          className="h-6 w-40 rounded-md border border-border bg-card px-1.5 text-xs font-semibold text-text-primary outline-none focus:ring-2 focus:ring-primary/40"
        />
      </span>
    );
  }
  return (
    <p className="group flex min-w-0 items-center gap-1.5 text-xs font-semibold text-text-primary">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} aria-hidden />
      <span className="truncate" title={label !== DEFAULT_LABEL[stage] ? `Stage: ${DEFAULT_LABEL[stage]}` : undefined}>
        {label}
      </span>
      {suffix ? <span className="shrink-0 font-normal text-text-tertiary">{suffix}</span> : null}
      {canRename ? (
        <button
          type="button"
          onClick={start}
          aria-label={`Rename ${label}`}
          title="Rename column"
          className="shrink-0 rounded p-0.5 text-text-tertiary opacity-0 transition hover:bg-black/5 hover:text-text-primary focus:opacity-100 group-hover:opacity-100 dark:hover:bg-white/10"
        >
          <Pencil className="h-3 w-3" />
        </button>
      ) : null}
    </p>
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
  canRename = false,
  onLose,
  onDelete,
  selectedIds,
  onToggleSelect,
  onSelectMany,
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
  /** Admin renomeia a coluna (vale para a equipe toda). */
  canRename?: boolean;
  /** Botão Lost do card: tira do pipeline (sem resposta, preço...). */
  onLose?: (l: Lead) => void;
  onDelete?: (l: Lead) => void;
  /** Seleção para ação em grupo (excluir, mover, Lost). */
  selectedIds?: Set<string>;
  onToggleSelect?: (l: Lead) => void;
  /** "Select all" da coluna. */
  onSelectMany?: (ls: Lead[]) => void;
}) {
  const STAGE_LABEL = useStageLabels();
  const selecting = !!selectedIds && selectedIds.size > 0;
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
                COLUMN.col,
                overStage === st && dragFrom !== st && "ring-2 ring-offset-2 ring-primary/50",
              )}
            >
              <div className="p-2">
                <header className="mb-2 flex items-center justify-between px-1">
                  <ColumnTitle
                    stage={st}
                    label={STAGE_LABEL[st]}
                    dot={COLUMN.dot}
                    canRename={canRename}
                    suffix={st === "lost" ? "· last 7 days" : null}
                  />
                  <span className="flex items-center gap-1.5">
                    {onSelectMany && selecting && rows.length ? (
                      <button
                        type="button"
                        onClick={() => onSelectMany(rows)}
                        className="rounded px-1 text-[11px] font-medium text-primary hover:underline"
                      >
                        Select all
                      </button>
                    ) : null}
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                        COLUMN.pill,
                      )}
                    >
                      {total}
                    </span>
                  </span>
                </header>
                <div className="space-y-2.5 pt-1">
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
                      stageLabel={STAGE_LABEL[l.stage ?? "new"]}
                      onLose={onLose}
                      onDelete={onDelete}
                      selected={!!selectedIds?.has(l.id)}
                      selecting={selecting}
                      onToggleSelect={onToggleSelect}
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
