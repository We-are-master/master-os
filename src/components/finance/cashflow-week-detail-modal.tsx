"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { CashflowBreakdownLine, CashflowWeekBreakdown } from "@/lib/billing-standalone-metrics";
import type { RunwayViewMode } from "@/lib/billing-runway-views";

function kindLabel(kind: CashflowBreakdownLine["kind"], view: RunwayViewMode): string {
  switch (kind) {
    case "invoice":
      return view === "accrual" ? "Revenue" : view === "cash" ? "Payment" : "Receivable";
    case "self_bill":
      return "Partner";
    case "expense":
      return "Expense";
    case "payroll":
      return "Payroll";
  }
}

function BreakdownSection({
  title,
  total,
  lines,
  tone,
  emptyLabel,
  view,
}: {
  title: string;
  total: number;
  lines: CashflowBreakdownLine[];
  tone: "in" | "out";
  emptyLabel: string;
  view: RunwayViewMode;
}) {
  const accent = tone === "in" ? "text-emerald-700" : "text-[#ED4B00]";
  const dot = tone === "in" ? "bg-emerald-600" : "bg-[#ED4B00]";
  const dateLabel = view === "cash" && tone === "in" ? "Paid" : "Due";

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-border-light bg-surface-hover/20">
      <div className="flex items-center justify-between gap-3 border-b border-border-light px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("h-2 w-2 shrink-0 rounded-sm", dot)} />
          <h3 className="text-sm font-semibold text-[#020040]">{title}</h3>
        </div>
        <p className={cn("shrink-0 text-sm font-bold tabular-nums", accent)}>{formatCurrency(total)}</p>
      </div>
      <div className="max-h-[min(36vh,260px)] sm:max-h-[min(40vh,280px)] overflow-y-auto divide-y divide-border-light/80">
        {lines.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-text-tertiary sm:px-4">{emptyLabel}</p>
        ) : (
          lines.map((line) => (
            <div
              key={`${line.kind}-${line.id}`}
              className="flex flex-col gap-1 px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3 sm:px-4 sm:py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text-primary break-words">{line.label}</p>
                <p className="text-[11px] leading-relaxed text-text-tertiary mt-0.5 break-words">
                  {kindLabel(line.kind, view)}
                  {line.detail ? ` · ${line.detail}` : ""}
                  {` · ${dateLabel} `}
                  {formatDate(line.dueYmd)}
                </p>
              </div>
              <p className={cn("shrink-0 text-sm font-semibold tabular-nums sm:text-right", accent)}>
                {formatCurrency(line.amount)}
              </p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
  view: RunwayViewMode;
  breakdown: CashflowWeekBreakdown | null;
  openingBalance?: number;
  closingBalance?: number;
  onSaveOpeningBalance?: (weekStart: string, amount: number) => void | Promise<void>;
  savingOpeningBalance?: boolean;
};

export function CashflowWeekDetailModal({
  open,
  onClose,
  view,
  breakdown,
  openingBalance,
  closingBalance,
  onSaveOpeningBalance,
  savingOpeningBalance,
}: Props) {
  const net = breakdown ? breakdown.moneyIn - breakdown.moneyOut : 0;
  const [openingDraft, setOpeningDraft] = useState("");

  useEffect(() => {
    if (!open || openingBalance === undefined) {
      setOpeningDraft("");
      return;
    }
    setOpeningDraft(String(openingBalance));
  }, [open, openingBalance, breakdown?.weekStart]);

  const accrualSections = useMemo(() => {
    if (!breakdown || view !== "accrual") return null;
    const partnerLines = breakdown.outLines.filter((l) => l.kind === "self_bill");
    const adminLines = breakdown.outLines.filter((l) => l.kind === "expense" || l.kind === "payroll");
    return {
      partnerTotal: partnerLines.reduce((s, l) => s + l.amount, 0),
      adminTotal: adminLines.reduce((s, l) => s + l.amount, 0),
      partnerLines,
      adminLines,
    };
  }, [breakdown, view]);

  const inTitle =
    view === "accrual" ? "Pipeline revenue" : view === "cash" ? "Customer payments" : "Receivables due";
  const outTitle =
    view === "accrual"
      ? "All costs due"
      : view === "cash"
        ? "Paid / projected payouts"
        : "Payouts + expenses due";
  const inEmpty =
    view === "accrual"
      ? "No pipeline revenue in this week."
      : view === "cash"
        ? "No customer payments this week."
        : "No receivables due this week.";
  const outEmpty =
    view === "accrual"
      ? "No partner payouts, bills, or payroll due this week."
      : view === "cash"
        ? "No payouts or expenses this week."
        : "No self-bills or expenses due this week.";

  const subtitle =
    breakdown == null
      ? undefined
      : (view === "cash" || view === "accrual") && closingBalance !== undefined
        ? `Mon–Sun · net ${net >= 0 ? "+" : ""}${formatCurrency(net)} · Em caixa ${formatCurrency(closingBalance)}`
        : `Projection for Mon–Sun · net ${net >= 0 ? "+" : ""}${formatCurrency(net)}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={breakdown?.title ?? "Week breakdown"}
      subtitle={subtitle}
      size="lg"
      className={view === "accrual" ? "max-w-6xl" : "max-w-3xl"}
    >
      <div className="flex flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-5 sm:pb-6">
        {(view === "cash" || view === "accrual") && breakdown && onSaveOpeningBalance ? (
          <div className="flex flex-col gap-3 rounded-xl border border-border-light bg-surface-hover/30 p-3 sm:flex-row sm:items-end sm:p-4">
            <div className="min-w-0 w-full flex-1 sm:max-w-xs">
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                Em caixa (opening balance)
              </label>
              <Input
                type="number"
                step="0.01"
                value={openingDraft}
                onChange={(e) => setOpeningDraft(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="w-full sm:w-auto"
              disabled={savingOpeningBalance}
              onClick={() => {
                const n = Number(openingDraft);
                if (!Number.isFinite(n)) return;
                void onSaveOpeningBalance(breakdown.weekStart, Math.round(n * 100) / 100);
              }}
            >
              {savingOpeningBalance ? "Saving…" : "Save opening"}
            </Button>
          </div>
        ) : null}
        {breakdown && view === "accrual" && accrualSections ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 xl:gap-5">
            <BreakdownSection
              title="Revenue"
              total={breakdown.moneyIn}
              lines={breakdown.inLines}
              tone="in"
              emptyLabel={inEmpty}
              view={view}
            />
            <BreakdownSection
              title="Partners"
              total={accrualSections.partnerTotal}
              lines={accrualSections.partnerLines}
              tone="out"
              emptyLabel="No partner payouts due this week."
              view={view}
            />
            <BreakdownSection
              title="Admin"
              total={accrualSections.adminTotal}
              lines={accrualSections.adminLines}
              tone="out"
              emptyLabel="No bills or payroll due this week."
              view={view}
            />
          </div>
        ) : breakdown ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
            <BreakdownSection
              title={inTitle}
              total={breakdown.moneyIn}
              lines={breakdown.inLines}
              tone="in"
              emptyLabel={inEmpty}
              view={view}
            />
            <BreakdownSection
              title={outTitle}
              total={breakdown.moneyOut}
              lines={breakdown.outLines}
              tone="out"
              emptyLabel={outEmpty}
              view={view}
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
