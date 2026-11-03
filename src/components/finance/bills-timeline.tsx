"use client";

import { useMemo } from "react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { Bill } from "@/types/database";
import { buildBillTimeline, monthKey, monthLabel } from "@/lib/bill-timeline";

const NAME_W = 200;
const ENDS_W = 84;
const MONTH_W = 96;

/**
 * Bills by month, from this month until the last bill that really ends (a loan,
 * a one-off). Ongoing bills (payroll, subscriptions) follow to that end at their
 * last amount. The bill name and its end stay fixed while the months scroll
 * sideways. Clicking a value opens that payment, so one month can be changed
 * without touching the rest.
 */
export function BillsTimeline({ bills, onOpenBill }: { bills: Bill[]; onOpenBill: (bill: Bill) => void }) {
  const thisMonth = monthKey(new Date());
  const { months, rows, totals } = useMemo(() => buildBillTimeline(bills, thisMonth), [bills, thisMonth]);
  const stickyName = "sticky left-0 z-10";
  const stickyEnds = "sticky z-10 border-r border-border";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-text-primary">
          {monthLabel(months[0])} to {monthLabel(months[months.length - 1])}
        </span>
        <span className="text-[11px] text-text-tertiary">
          {months.length} months · until the last bill that ends · scroll sideways
        </span>
        <div className="ml-auto flex flex-wrap gap-3 text-[11px] text-text-tertiary">
          <span>
            <span className="font-semibold text-amber-600">£</span> price changed
          </span>
          <span>
            <span className="border-r-2 border-amber-500 pr-1">£</span> last payment
          </span>
          <span>
            <span className="italic">£</span> ongoing, not scheduled yet
          </span>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table
          className="table-fixed border-collapse text-[12px]"
          style={{ width: NAME_W + ENDS_W + MONTH_W * months.length, minWidth: "100%" }}
        >
          <colgroup>
            <col style={{ width: NAME_W }} />
            <col style={{ width: ENDS_W }} />
            {months.map((m) => (
              <col key={m} style={{ width: MONTH_W }} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-surface-secondary text-[11px] text-text-tertiary">
              <th className={cn(stickyName, "bg-surface-secondary px-3 py-2 text-left font-medium")}>Bill</th>
              <th className={cn(stickyEnds, "bg-surface-secondary px-3 py-2 text-right font-medium")} style={{ left: NAME_W }}>
                Ends
              </th>
              {months.map((m) => (
                <th
                  key={m}
                  className={cn(
                    "px-3 py-2 text-right font-medium",
                    m === thisMonth && "text-text-primary",
                    m.endsWith("-01") && "border-l border-border",
                  )}
                >
                  {monthLabel(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={months.length + 2} className="px-3 py-8 text-center text-text-tertiary">
                  No bills ahead.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.key} className="border-t border-border/60">
                  <td className={cn(stickyName, "truncate bg-card px-3 py-2 font-semibold text-text-primary")} title={row.title}>
                    {row.title}
                  </td>
                  <td
                    className={cn(stickyEnds, "whitespace-nowrap bg-card px-3 py-2 text-right text-[11px] text-text-tertiary")}
                    style={{ left: NAME_W }}
                    title={row.ongoing ? "Keeps going" : row.endYmd ? `Last payment ${formatDate(row.endYmd)}` : undefined}
                  >
                    {row.ongoing ? "Ongoing" : row.endYmd ? monthLabel(monthKey(row.endYmd)) : "—"}
                  </td>
                  {row.cells.map((c) => (
                    <td
                      key={c.month}
                      className={cn(
                        "p-0 text-right tabular-nums",
                        c.month.endsWith("-01") && "border-l border-border",
                        c.last && "shadow-[inset_-2px_0_0_theme(colors.amber.500)]",
                      )}
                    >
                      {c.bills.length ? (
                        <button
                          type="button"
                          title={c.bills.map((b) => `${formatDate(b.due_date)} · ${formatCurrency(b.amount)}`).join("\n")}
                          onClick={() => onOpenBill(c.bills[0])}
                          className={cn(
                            "w-full px-3 py-2 text-right hover:bg-surface-hover",
                            c.changed ? "font-semibold text-amber-600" : "text-text-primary",
                          )}
                        >
                          {formatCurrency(c.amount)}
                          {c.bills.length > 1 ? (
                            <span className="block text-[10px] font-normal text-text-tertiary">{c.bills.length} payments</span>
                          ) : null}
                        </button>
                      ) : c.projected ? (
                        <span className="block px-3 py-2 italic text-text-tertiary" title="Ongoing: carried at the last amount">
                          {formatCurrency(c.amount)}
                        </span>
                      ) : (
                        <span className="block px-3 py-2 text-text-tertiary">·</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {rows.length ? (
            <tfoot>
              <tr className="border-t border-border bg-surface-secondary font-semibold">
                <td className={cn(stickyName, "bg-surface-secondary px-3 py-2 text-text-primary")}>Total</td>
                <td className={cn(stickyEnds, "bg-surface-secondary")} style={{ left: NAME_W }} />
                {totals.map((t, i) => (
                  <td
                    key={months[i]}
                    className={cn("px-3 py-2 text-right tabular-nums text-text-primary", months[i].endsWith("-01") && "border-l border-border")}
                  >
                    {formatCurrency(t)}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
