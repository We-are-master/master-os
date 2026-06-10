"use client";

import { Modal } from "@/components/ui/modal";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { CashflowBreakdownLine, CashflowWeekBreakdown } from "@/lib/billing-standalone-metrics";

function kindLabel(kind: CashflowBreakdownLine["kind"]): string {
  switch (kind) {
    case "invoice":
      return "Receivable";
    case "self_bill":
      return "Self-bill";
    case "expense":
      return "Expense";
  }
}

function BreakdownSection({
  title,
  total,
  lines,
  tone,
  emptyLabel,
}: {
  title: string;
  total: number;
  lines: CashflowBreakdownLine[];
  tone: "in" | "out";
  emptyLabel: string;
}) {
  const accent = tone === "in" ? "text-emerald-700" : "text-[#ED4B00]";
  const dot = tone === "in" ? "bg-emerald-600" : "bg-[#ED4B00]";

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-border-light bg-surface-hover/20">
      <div className="flex items-center justify-between gap-3 border-b border-border-light px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 shrink-0 rounded-sm", dot)} />
          <h3 className="text-sm font-semibold text-[#020040]">{title}</h3>
        </div>
        <p className={cn("text-sm font-bold tabular-nums", accent)}>{formatCurrency(total)}</p>
      </div>
      <div className="max-h-[min(40vh,280px)] overflow-y-auto divide-y divide-border-light/80">
        {lines.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-text-tertiary">{emptyLabel}</p>
        ) : (
          lines.map((line) => (
            <div key={`${line.kind}-${line.id}`} className="flex items-start justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{line.label}</p>
                <p className="text-[11px] text-text-tertiary mt-0.5">
                  {kindLabel(line.kind)}
                  {line.detail ? ` · ${line.detail}` : ""}
                  {" · Due "}
                  {formatDate(line.dueYmd)}
                </p>
              </div>
              <p className={cn("shrink-0 text-sm font-semibold tabular-nums", accent)}>
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
  breakdown: CashflowWeekBreakdown | null;
};

export function CashflowWeekDetailModal({ open, onClose, breakdown }: Props) {
  const net = breakdown ? breakdown.moneyIn - breakdown.moneyOut : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={breakdown?.title ?? "Week breakdown"}
      subtitle={
        breakdown
          ? `Projection for Mon–Sun · net ${net >= 0 ? "+" : ""}${formatCurrency(net)}`
          : undefined
      }
      size="lg"
    >
      {breakdown ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BreakdownSection
            title="Receivables due"
            total={breakdown.moneyIn}
            lines={breakdown.inLines}
            tone="in"
            emptyLabel="No receivables due this week."
          />
          <BreakdownSection
            title="Payouts + expenses due"
            total={breakdown.moneyOut}
            lines={breakdown.outLines}
            tone="out"
            emptyLabel="No self-bills or expenses due this week."
          />
        </div>
      ) : null}
    </Modal>
  );
}
