"use client";

import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  FileText,
  LayoutGrid,
  LayoutList,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  Wallet,
} from "lucide-react";
import type { InternalCost, BusinessUnit } from "@/types/database";

export type WorkforcePeopleRow = InternalCost & { bu_name?: string | null };

export const workforceFieldClass =
  "rounded-xl border-border-light bg-card shadow-sm focus-visible:ring-primary/30";

export const workforceSectionClass =
  "rounded-2xl border border-border-light bg-card p-4 sm:p-5 shadow-sm space-y-4";

export function WorkforceKpiGrid({
  headcount,
  active,
  onboarding,
  monthlyPayroll,
  payrollPeople,
  docsOutstanding,
  dueThisMonthCount,
  dueThisMonthTotal,
}: {
  headcount: number;
  active: number;
  onboarding: number;
  monthlyPayroll: number;
  payrollPeople: number;
  docsOutstanding: number;
  dueThisMonthCount: number;
  dueThisMonthTotal: number;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <div className="rounded-2xl border border-border-light bg-card px-4 py-3.5 shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Headcount</p>
        <p className="text-2xl font-bold tabular-nums text-text-primary mt-1">{headcount}</p>
        <p className="text-xs text-text-secondary mt-0.5">
          {active} active · {onboarding} onboarding
        </p>
      </div>
      <div className="rounded-2xl border border-border-light bg-card px-4 py-3.5 shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Monthly payroll</p>
        <p className="text-2xl font-bold tabular-nums text-primary mt-1">{formatCurrency(monthlyPayroll)}</p>
        <p className="text-xs text-text-secondary mt-0.5">
          across {payrollPeople} {payrollPeople === 1 ? "person" : "people"}
        </p>
      </div>
      <div className="rounded-2xl border border-border-light bg-card px-4 py-3.5 shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Docs outstanding</p>
        <p className="text-2xl font-bold tabular-nums text-rose-600 dark:text-rose-400 mt-1">{docsOutstanding}</p>
        <p className="text-xs text-text-secondary mt-0.5">needs attention</p>
      </div>
      <div className="rounded-2xl border border-border-light bg-card px-4 py-3.5 shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Due this month</p>
        <p className="text-2xl font-bold tabular-nums text-text-primary mt-1">{dueThisMonthCount}</p>
        <p className="text-xs text-text-secondary mt-0.5">{formatCurrency(dueThisMonthTotal)} total</p>
      </div>
    </div>
  );
}

export function WorkforceBuStrip({
  bus,
  buFilter,
  onFilter,
  onAdd,
  onEdit,
  onDelete,
}: {
  bus: BusinessUnit[];
  buFilter: string;
  onFilter: (id: string) => void;
  onAdd: () => void;
  onEdit: (bu: BusinessUnit) => void;
  onDelete: (bu: BusinessUnit) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mr-1">Business Units</span>
      {bus.map((s) => {
        const active = buFilter === s.id;
        return (
          <div
            key={s.id}
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full border pl-3 pr-1 py-1 transition-colors",
              active
                ? "border-primary/50 bg-primary/5 shadow-sm"
                : "border-border-light bg-card hover:border-border",
            )}
          >
            <button
              type="button"
              onClick={() => onFilter(active ? "all" : s.id)}
              className={cn(
                "text-xs font-semibold pr-1",
                active ? "text-primary" : "text-text-primary",
              )}
            >
              {s.name}
            </button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              aria-label={`Edit ${s.name}`}
              onClick={() => onEdit(s)}
              icon={<Pencil className="h-3 w-3" />}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-rose-600"
              aria-label={`Delete ${s.name}`}
              onClick={() => onDelete(s)}
              icon={<Trash2 className="h-3 w-3" />}
            />
          </div>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border-light px-3 py-1.5 text-xs font-semibold text-text-secondary hover:border-primary/40 hover:text-primary transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        Add BU
      </button>
    </div>
  );
}

export type WorkforcePeopleTab = "all" | "internal" | "contractors";

export function WorkforceTypeSegment({
  value,
  onChange,
  counts,
}: {
  value: WorkforcePeopleTab;
  onChange: (v: WorkforcePeopleTab) => void;
  counts: { all: number; internal: number; contractors: number };
}) {
  const items: { id: WorkforcePeopleTab; label: string; count: number }[] = [
    { id: "all", label: "All", count: counts.all },
    { id: "internal", label: "Employees", count: counts.internal },
    { id: "contractors", label: "Contractors", count: counts.contractors },
  ];
  return (
    <div className="inline-flex max-w-full overflow-x-auto bg-fx-paper-2 rounded-md p-[3px] gap-0.5 [scrollbar-width:thin]">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            "shrink-0 px-3 py-[5px] rounded text-[12.5px] font-medium transition-colors inline-flex items-center gap-1.5 whitespace-nowrap",
            value === item.id
              ? "bg-card text-text-primary shadow-fx-1"
              : "bg-transparent text-fx-mute hover:text-text-primary",
          )}
        >
          {item.label}
          <span className="font-mono text-[11px] font-semibold tabular-nums text-fx-coral-p">{item.count}</span>
        </button>
      ))}
    </div>
  );
}

export function WorkforceStagePills({
  value,
  onChange,
}: {
  value: "all" | "onboarding" | "active" | "offboard";
  onChange: (v: "all" | "onboarding" | "active" | "offboard") => void;
}) {
  const items = [
    { id: "all" as const, label: "All" },
    { id: "onboarding" as const, label: "Onboarding" },
    { id: "active" as const, label: "Active" },
    { id: "offboard" as const, label: "Offboarded" },
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onChange(s.id)}
          className={cn(
            "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors border",
            value === s.id
              ? "bg-fx-coral text-white border-fx-coral"
              : "bg-card border-fx-line text-text-primary hover:bg-fx-paper",
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

export function WorkforceViewToggle({
  mode,
  onChange,
}: {
  mode: "grid" | "list";
  onChange: (mode: "grid" | "list") => void;
}) {
  return (
    <div
      className="inline-flex shrink-0 rounded-lg border border-border-light bg-card p-[3px] gap-0.5"
      role="group"
      aria-label="Workforce view mode"
    >
      <button
        type="button"
        aria-pressed={mode === "list"}
        onClick={() => onChange("list")}
        className={cn(
          "rounded-md px-2.5 py-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          mode === "list"
            ? "bg-surface-secondary text-text-primary shadow-sm ring-1 ring-border/70"
            : "text-text-tertiary hover:text-text-primary hover:bg-surface-hover",
        )}
        title="List view"
      >
        <LayoutList className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        aria-pressed={mode === "grid"}
        onClick={() => onChange("grid")}
        className={cn(
          "rounded-md px-2.5 py-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          mode === "grid"
            ? "bg-surface-secondary text-text-primary shadow-sm ring-1 ring-border/70"
            : "text-text-tertiary hover:text-text-primary hover:bg-surface-hover",
        )}
        title="Grid view"
      >
        <LayoutGrid className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function DocsProgressBadge({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const complete = done >= total;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        complete
          ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-200"
          : done === 0
            ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-950/30 dark:text-rose-200"
            : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200",
      )}
    >
      Docs {done}/{total}
      <span className="inline-flex h-1.5 w-8 overflow-hidden rounded-full bg-black/10">
        <span
          className={cn("h-full rounded-full", complete ? "bg-emerald-500" : done === 0 ? "bg-rose-500" : "bg-amber-500")}
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}

function LifecycleDotBadge({ stage }: { stage: string }) {
  const isActive = stage === "active";
  const isOnboarding = stage === "onboarding";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        isActive
          ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-950/30"
          : isOnboarding
            ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30"
            : "border-border-light bg-surface-hover text-text-secondary",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          isActive ? "bg-emerald-500" : isOnboarding ? "bg-amber-500" : "bg-text-tertiary",
        )}
      />
      {isOnboarding ? "Onboarding" : isActive ? "Active" : stage}
    </span>
  );
}

export function WorkforcePersonCard({
  row,
  photoUrl,
  employmentType,
  docsDone,
  docsTotal,
  activating,
  onboardingLinkBusy,
  onOpen,
  onOpenDocuments,
  onOpenFinance,
  onActivate,
  onCopyOnboardingLink,
}: {
  row: WorkforcePeopleRow;
  photoUrl?: string;
  employmentType: InternalCost["employment_type"];
  docsDone: number;
  docsTotal: number;
  activating: boolean;
  onboardingLinkBusy?: boolean;
  onOpen: () => void;
  onOpenDocuments: () => void;
  onOpenFinance: () => void;
  onActivate: () => void;
  onCopyOnboardingLink: () => void;
}) {
  const stage = row.lifecycle_stage ?? "active";
  const docsIncomplete = docsTotal > 0 && docsDone < docsTotal;
  const showOnboardingLink = stage === "onboarding" || docsIncomplete;
  const emailLine =
    row.payroll_profile && typeof row.payroll_profile === "object" && "email" in (row.payroll_profile as object)
      ? String((row.payroll_profile as { email?: string }).email ?? "").trim()
      : "";

  return (
    <article className="rounded-2xl border border-border-light bg-card shadow-sm hover:shadow-md hover:border-primary/20 transition-all flex flex-col overflow-hidden">
      <button type="button" onClick={onOpen} className="text-left p-4 flex flex-col gap-3 flex-1 min-w-0">
        <div className="flex items-start gap-3 min-w-0">
          <Avatar name={row.payee_name ?? "?"} size="lg" src={photoUrl} className="shrink-0 ring-2 ring-card" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-text-primary truncate text-[15px]">{row.payee_name ?? "Unnamed"}</p>
            {emailLine ? <p className="text-xs text-text-secondary truncate">{emailLine}</p> : null}
            <p className="text-[11px] text-text-tertiary uppercase tracking-wide mt-0.5 line-clamp-2">{row.description}</p>
            <div className="flex flex-wrap gap-1.5 mt-2 items-center">
              <LifecycleDotBadge stage={stage} />
              {docsTotal > 0 ? <DocsProgressBadge done={docsDone} total={docsTotal} /> : null}
              {employmentType === "self_employed" ? (
                <Badge variant="info" size="sm" className="text-[10px] uppercase tracking-wide">
                  Contractor
                </Badge>
              ) : null}
              {showOnboardingLink ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopyOnboardingLink();
                  }}
                  disabled={onboardingLinkBusy}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                  title="Generate onboarding link (copied to clipboard)"
                >
                  {onboardingLinkBusy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Link2 className="h-3 w-3" />
                  )}
                  Onboarding
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-border-light pt-3 text-xs">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Amount</p>
            <p className="font-bold text-text-primary tabular-nums mt-0.5">{formatCurrency(Number(row.amount))}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Next due</p>
            <p className="font-semibold text-text-primary mt-0.5">{row.due_date ? formatDate(row.due_date) : "—"}</p>
            {row.status === "pending" ? (
              <p className="text-[10px] font-semibold text-primary mt-0.5">Pending</p>
            ) : null}
          </div>
        </div>
      </button>
      <div className="grid grid-cols-2 gap-2 p-3 pt-0 border-t border-border-light/80">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full rounded-xl h-9 text-xs font-semibold"
          icon={<FileText className="h-3.5 w-3.5" />}
          onClick={() => onOpenDocuments()}
        >
          Documents
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full rounded-xl h-9 text-xs font-semibold"
          icon={<Wallet className="h-3.5 w-3.5" />}
          onClick={() => onOpenFinance()}
        >
          Finance
        </Button>
      </div>
      {stage === "onboarding" ? (
        <div className="px-3 pb-3">
          <Button
            type="button"
            size="sm"
            variant="primary"
            className="w-full rounded-xl h-9 text-xs"
            disabled={activating}
            icon={
              activating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />
            }
            onClick={() => onActivate()}
          >
            Activate
          </Button>
        </div>
      ) : null}
    </article>
  );
}

export function WorkforcePersonListRow({
  row,
  photoUrl,
  employmentType,
  docsDone,
  docsTotal,
  activating,
  onboardingLinkBusy,
  onOpen,
  onOpenDocuments,
  onOpenFinance,
  onActivate,
  onCopyOnboardingLink,
}: {
  row: WorkforcePeopleRow;
  photoUrl?: string;
  employmentType: InternalCost["employment_type"];
  docsDone: number;
  docsTotal: number;
  activating: boolean;
  onboardingLinkBusy?: boolean;
  onOpen: () => void;
  onOpenDocuments: () => void;
  onOpenFinance: () => void;
  onActivate: () => void;
  onCopyOnboardingLink: () => void;
}) {
  const stage = row.lifecycle_stage ?? "active";
  const docsIncomplete = docsTotal > 0 && docsDone < docsTotal;
  const showOnboardingLink = stage === "onboarding" || docsIncomplete;
  const emailLine =
    row.payroll_profile && typeof row.payroll_profile === "object" && "email" in (row.payroll_profile as object)
      ? String((row.payroll_profile as { email?: string }).email ?? "").trim()
      : "";

  return (
    <div className="group flex flex-col gap-2 border-b border-border-light px-4 py-3 last:border-b-0 hover:bg-surface-hover/40 sm:grid sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto_auto_auto] sm:items-center sm:gap-3">
      <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-3 text-left">
        <Avatar name={row.payee_name ?? "?"} size="md" src={photoUrl} className="shrink-0 ring-2 ring-card" />
        <div className="min-w-0">
          <p className="font-semibold text-text-primary truncate">{row.payee_name ?? "Unnamed"}</p>
          {emailLine ? <p className="text-xs text-text-secondary truncate">{emailLine}</p> : null}
          <p className="text-[11px] text-text-tertiary truncate">{row.description ?? "—"}</p>
          <div className="flex flex-wrap gap-1.5 mt-1.5 sm:hidden">
            <LifecycleDotBadge stage={stage} />
            {employmentType === "self_employed" ? (
              <Badge variant="info" size="sm" className="text-[10px] uppercase tracking-wide">
                Contractor
              </Badge>
            ) : (
              <Badge variant="default" size="sm" className="text-[10px] uppercase tracking-wide">
                Employee
              </Badge>
            )}
          </div>
        </div>
      </button>
      <div className="hidden sm:flex flex-wrap items-center gap-1.5 min-w-0">
        <LifecycleDotBadge stage={stage} />
        {docsTotal > 0 ? <DocsProgressBadge done={docsDone} total={docsTotal} /> : null}
        {employmentType === "self_employed" ? (
          <Badge variant="info" size="sm" className="text-[10px] uppercase tracking-wide">
            Contractor
          </Badge>
        ) : (
          <Badge variant="default" size="sm" className="text-[10px] uppercase tracking-wide">
            Employee
          </Badge>
        )}
        {showOnboardingLink ? (
          <button
            type="button"
            onClick={() => onCopyOnboardingLink()}
            disabled={onboardingLinkBusy}
            className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
            title="Copy onboarding link"
          >
            {onboardingLinkBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
            Onboarding
          </button>
        ) : null}
      </div>
      <div className="hidden sm:block text-right">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Amount</p>
        <p className="font-bold text-text-primary tabular-nums">{formatCurrency(Number(row.amount))}</p>
      </div>
      <div className="hidden sm:block text-right min-w-[5.5rem]">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">Next due</p>
        <p className="font-semibold text-text-primary">{row.due_date ? formatDate(row.due_date) : "—"}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
        <div className="flex gap-1 sm:hidden text-xs tabular-nums">
          <span className="font-bold text-text-primary">{formatCurrency(Number(row.amount))}</span>
          <span className="text-text-tertiary">·</span>
          <span className="text-text-secondary">{row.due_date ? formatDate(row.due_date) : "—"}</span>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenDocuments()}>
          Docs
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenFinance()}>
          Finance
        </Button>
        {stage === "onboarding" ? (
          <Button
            type="button"
            size="sm"
            variant="primary"
            className="h-8 text-xs"
            disabled={activating}
            onClick={() => onActivate()}
          >
            {activating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Activate"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function WorkforceAddListRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-t border-dashed border-border-light px-4 py-3 text-left hover:bg-primary/[0.03] transition-colors"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-hover text-text-tertiary">
        <UserPlus className="h-4 w-4" />
      </span>
      <span className="text-sm font-semibold text-text-secondary">{label}</span>
    </button>
  );
}

export function WorkforceAddCard({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border-2 border-dashed border-border-light bg-surface-hover/20 hover:border-primary/35 hover:bg-primary/[0.03] transition-colors min-h-[220px] flex flex-col items-center justify-center gap-2 p-6 text-center"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-hover text-text-tertiary">
        <UserPlus className="h-5 w-5" />
      </span>
      <span className="text-sm font-semibold text-text-secondary">{label}</span>
    </button>
  );
}

export function WorkforceDrawerStatusBadge({ stage }: { stage: string }) {
  return <LifecycleDotBadge stage={stage} />;
}

export type WorkforceDrawerTab = "overview" | "documents" | "finance" | "access";
