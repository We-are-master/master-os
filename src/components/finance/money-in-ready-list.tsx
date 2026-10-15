"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { CheckCheck, ChevronDown, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { jobStatusBadgeVariant, jobStatusLabel } from "@/lib/job-status-ui";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { displayBillingReference } from "@/lib/billing-reference";
import type { AttentionAccountGroup } from "@/lib/billing-standalone-metrics";
import type { InvoiceListJobSnapshot } from "@/lib/billing-invoice-list-data";
import type { Invoice } from "@/types/database";

const INITIAL_VISIBLE_ROWS = 12;
const LOAD_MORE_ROWS = 20;

function invoiceCanSelectForPayment(
  inv: Invoice,
  jobsByRef: Record<string, InvoiceListJobSnapshot>,
): boolean {
  if (inv.status === "paid" || inv.status === "cancelled" || inv.status === "on_hold") return false;
  const jobOnHold = inv.job_reference?.trim()
    ? jobsByRef[inv.job_reference.trim()]?.status === "on_hold"
    : false;
  return !jobOnHold;
}

function openInvoicePdf(invoiceId: string) {
  window.open(`/api/invoices/${invoiceId}/pdf`, "_blank", "noopener,noreferrer");
}

type Props = {
  groups: AttentionAccountGroup[];
  accountLogoById: Record<string, string | null>;
  jobsByRef: Record<string, InvoiceListJobSnapshot>;
  selectedInvoiceIds: Set<string>;
  resetKey: string;
  onToggleInvoiceSelection: (ids: string[], selected: boolean) => void;
  onOpenInvoice: (inv: Invoice) => void;
  onMarkReceived: (id: string) => void;
};

function MoneyInReadyListInner({
  groups,
  accountLogoById,
  jobsByRef,
  selectedInvoiceIds,
  resetKey,
  onToggleInvoiceSelection,
  onOpenInvoice,
  onMarkReceived,
}: Props) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [visibleByGroup, setVisibleByGroup] = useState<Record<string, number>>({});
  const groupsSigRef = useRef("");

  useEffect(() => {
    setExpandedKeys(new Set());
    setVisibleByGroup({});
    groupsSigRef.current = "";
  }, [resetKey]);

  useEffect(() => {
    const sig = groups.map((g) => `${g.accountKey}:${g.invoiceCount}`).join("|");
    if (sig === groupsSigRef.current) return;
    groupsSigRef.current = sig;
    // Always start collapsed — user expands accounts on demand.
    setExpandedKeys(new Set());
    setVisibleByGroup({});
  }, [groups]);

  const toggleExpanded = useCallback((accountKey: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(accountKey)) next.delete(accountKey);
      else next.add(accountKey);
      return next;
    });
  }, []);

  const showMore = useCallback((accountKey: string, total: number) => {
    setVisibleByGroup((prev) => {
      const current = prev[accountKey] ?? INITIAL_VISIBLE_ROWS;
      return { ...prev, [accountKey]: Math.min(total, current + LOAD_MORE_ROWS) };
    });
  }, []);

  if (groups.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-sm text-text-tertiary">Nothing to collect right now.</p>
    );
  }

  return (
    <>
      {groups.map((group) => {
        const open = expandedKeys.has(group.accountKey);
        const logoUrl = group.accountId ? accountLogoById[group.accountId] : null;
        const groupSelectableIds = group.rows
          .filter((row) => invoiceCanSelectForPayment(row.invoice, jobsByRef))
          .map((row) => row.invoice.id);
        const groupAllSelected =
          groupSelectableIds.length > 0 &&
          groupSelectableIds.every((id) => selectedInvoiceIds.has(id));
        const visibleLimit = visibleByGroup[group.accountKey] ?? INITIAL_VISIBLE_ROWS;
        const visibleRows = open ? group.rows.slice(0, visibleLimit) : [];
        const hasMore = open && group.rows.length > visibleLimit;

        return (
          <div key={group.accountKey}>
            <div className="bl-ledger-partner flex items-center gap-2 px-4 py-1.5">
              {groupSelectableIds.length > 0 ? (
                <input
                  type="checkbox"
                  checked={groupAllSelected}
                  onChange={(e) => onToggleInvoiceSelection(groupSelectableIds, e.target.checked)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-3.5 w-3.5 shrink-0 accent-[#020040]"
                  aria-label={`Select all ${group.accountName} invoices`}
                />
              ) : (
                <span className="w-3.5 shrink-0" aria-hidden />
              )}
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left hover:opacity-90"
                onClick={() => toggleExpanded(group.accountKey)}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoUrl}
                      alt=""
                      className="h-6 w-6 shrink-0 rounded-full border border-border-light bg-white object-contain p-0.5"
                    />
                  ) : (
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-800">
                      {group.accountName.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="flex min-w-0 items-baseline gap-2">
                    <p className="m-0 shrink-0 text-[13px] font-semibold text-text-primary">{group.accountName}</p>
                    <p className="m-0 truncate text-[12px] text-text-tertiary">
                      {group.invoiceCount} invoice{group.invoiceCount === 1 ? "" : "s"}
                      {group.maxDaysLate > 0 ? ` · ${group.maxDaysLate}d late` : ""}
                      {group.nextExpectedPayYmd
                        ? ` · Due ${formatDate(group.nextExpectedPayYmd)}`
                        : ""}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <p className="text-sm font-semibold tabular-nums text-text-secondary">
                    {formatCurrency(group.totalDue)}
                  </p>
                  <ChevronDown
                    className={cn("h-4 w-4 text-text-tertiary transition-transform", open && "rotate-180")}
                  />
                </div>
              </button>
            </div>
            {open ? (
              <div className="divide-y divide-border-light border-t border-border-light">
                {visibleRows.map((row, rowIdx) => {
                  const canSelect = invoiceCanSelectForPayment(row.invoice, jobsByRef);
                  const jobRef = row.invoice.job_reference?.trim() || "";
                  const job = jobRef ? jobsByRef[jobRef] : undefined;
                  const jobDateYmd =
                    job?.completed_date?.trim().slice(0, 10) ||
                    job?.scheduled_date?.trim().slice(0, 10) ||
                    job?.scheduled_start_at?.trim().slice(0, 10) ||
                    "";
                  return (
                    <div
                      key={row.invoice.id}
                      className={cn(
                        "bl-ledger-row flex cursor-pointer items-center gap-2 py-1.5 pl-4 pr-4 hover:bg-surface-hover",
                        rowIdx % 2 === 1 && "bl-ledger-row--alt",
                      )}
                      onClick={() => onOpenInvoice(row.invoice)}
                    >
                      {canSelect ? (
                        <input
                          type="checkbox"
                          onClick={(e) => e.stopPropagation()}
                          checked={selectedInvoiceIds.has(row.invoice.id)}
                          onChange={(e) =>
                            onToggleInvoiceSelection([row.invoice.id], e.target.checked)
                          }
                          className="h-3.5 w-3.5 shrink-0 accent-[#020040]"
                          aria-label={`Select ${displayBillingReference(row.invoice.reference)}`}
                        />
                      ) : (
                        <span className="w-3.5 shrink-0" aria-hidden />
                      )}
                      <span
                        className={cn(
                          "h-5 w-1 shrink-0 rounded-full",
                          row.daysLate > 0 ? "bg-red-500" : "bg-amber-400",
                        )}
                      />
                      <div className="flex min-w-0 flex-1 items-baseline gap-1.5 whitespace-nowrap">
                        <span className="shrink-0 text-[13px] font-semibold text-text-primary">
                          {displayBillingReference(row.invoice.reference)}
                        </span>
                        {job && jobRef ? (
                          <a
                            href={`/jobs/${job.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0 text-[12px] font-medium text-primary underline-offset-2 hover:underline"
                            title={`Open ${jobRef}${jobDateYmd ? ` · ${formatDate(jobDateYmd)}` : ""}`}
                          >
                            · {jobRef}
                          </a>
                        ) : null}
                        <span className="truncate text-[12px] text-text-tertiary">· {row.clientName}</span>
                      </div>
                      {job?.status ? (
                        <Badge variant={jobStatusBadgeVariant(job.status)} size="sm" marker className="shrink-0">
                          {jobStatusLabel(job.status)}
                        </Badge>
                      ) : null}
                      <span
                        className={cn(
                          "shrink-0 whitespace-nowrap text-[12px] tabular-nums",
                          row.daysLate > 0 ? "font-medium text-[var(--bad)]" : "text-text-secondary",
                        )}
                      >
                        {row.paymentPlanLabel
                          ? row.paymentPlanLabel
                          : row.daysLate > 0
                            ? `${row.daysLate}d late`
                            : row.expectedPayYmd
                              ? `Due ${new Date(`${row.expectedPayYmd.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`
                              : "Due soon"}
                      </span>
                      <span className="w-24 shrink-0 text-right text-[13px] font-semibold tabular-nums text-text-primary">
                        {formatCurrency(row.balanceDue)}
                      </span>
                      <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {canSelect ? (
                          <button
                            type="button"
                            title="Mark as received"
                            aria-label="Mark as received"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border text-[var(--ok)] hover:bg-[var(--success-light)]"
                            onClick={() => onMarkReceived(row.invoice.id)}
                          >
                            <CheckCheck className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          title="View PDF"
                          aria-label="View PDF"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border text-text-secondary hover:bg-surface-hover"
                          onClick={() => openInvoicePdf(row.invoice.id)}
                        >
                          <FileText className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {hasMore ? (
                  <div className="px-5 py-2.5">
                    <button
                      type="button"
                      className="text-xs font-semibold text-primary hover:underline"
                      onClick={() => showMore(group.accountKey, group.rows.length)}
                    >
                      Show more ({group.rows.length - visibleLimit} remaining)
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function propsAreEqual(prev: Props, next: Props): boolean {
  return (
    prev.groups === next.groups &&
    prev.accountLogoById === next.accountLogoById &&
    prev.jobsByRef === next.jobsByRef &&
    prev.selectedInvoiceIds === next.selectedInvoiceIds &&
    prev.resetKey === next.resetKey &&
    prev.onToggleInvoiceSelection === next.onToggleInvoiceSelection &&
    prev.onOpenInvoice === next.onOpenInvoice &&
    prev.onMarkReceived === next.onMarkReceived
  );
}

export const MoneyInReadyList = memo(MoneyInReadyListInner, propsAreEqual);
