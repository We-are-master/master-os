"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { Bill } from "@/types/database";
import { addMonths, buildBillTimeline, monthKey, monthLabel } from "@/lib/bill-timeline";

const WINDOW = 6;

/**
 * Bills by month: one row per bill, the amount due in each month of a 6-month
 * window, where the price changes and where the bill ends. Clicking a value
 * opens that payment, so one month can be changed without touching the rest.
 */
export function BillsTimeline({ bills, onOpenBill }: { bills: Bill[]; onOpenBill: (bill: Bill) => void }) {
  const thisMonth = monthKey(new Date());
  const [offset, setOffset] = useState(0);
  const start = addMonths(thisMonth, offset);
  const { months, rows, totals } = useMemo(() => buildBillTimeline(bills, start, WINDOW), [bills, start]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label="Previous months"
          icon={<ChevronLeft className="h-3.5 w-3.5" />}
          onClick={() => setOffset((o) => o - WINDOW)}
        />
        <span className="min-w-[130px] text-center text-[13px] font-semibold text-text-primary">
          {monthLabel(months[0])} to {monthLabel(months[months.length - 1])}
        </span>
        <Button
          variant="outline"
          size="sm"
          aria-label="Next months"
          icon={<ChevronRight className="h-3.5 w-3.5" />}
          onClick={() => setOffset((o) => o + WINDOW)}
        />
        {offset !== 0 ? (
          <Button variant="ghost" size="sm" onClick={() => setOffset(0)}>
            Today
          </Button>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-3 text-[11px] text-text-tertiary">
          <span>
            <span className="font-semibold text-amber-600">£</span> price changed
          </span>
          <span>
            <span className="border-r-2 border-amber-500 pr-1">£</span> last payment
          </span>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[760px] table-fixed border-collapse text-[12px]">
          <thead>
            <tr className="bg-surface-secondary text-[11px] text-text-tertiary">
              <th className="sticky left-0 w-[220px] bg-surface-secondary px-3 py-2 text-left font-medium">Bill</th>
              {months.map((m) => (
                <th key={m} className={cn("px-3 py-2 text-right font-medium", m === thisMonth && "text-text-primary")}>
                  {monthLabel(m)}
                </th>
              ))}
              <th className="w-[104px] px-3 py-2 text-right font-medium">Ends</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={months.length + 2} className="px-3 py-8 text-center text-text-tertiary">
                  No bills in these months.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.key} className="border-t border-border/60">
                  <td className="sticky left-0 truncate bg-card px-3 py-2 font-semibold text-text-primary" title={row.title}>
                    {row.title}
                  </td>
                  {row.cells.map((c) => (
                    <td key={c.month} className={cn("p-0 text-right tabular-nums", c.last && "shadow-[inset_-2px_0_0_theme(colors.amber.500)]")}>
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
                      ) : (
                        <span className="block px-3 py-2 text-text-tertiary">·</span>
                      )}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-2 text-right text-[11px] text-text-tertiary" title={row.endYmd ? `Last payment ${formatDate(row.endYmd)}` : undefined}>
                    {row.ongoing ? "Ongoing" : row.endYmd ? monthLabel(monthKey(row.endYmd)) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length ? (
            <tfoot>
              <tr className="border-t border-border bg-surface-secondary font-semibold">
                <td className="sticky left-0 bg-surface-secondary px-3 py-2 text-text-primary">Total</td>
                {totals.map((t, i) => (
                  <td key={months[i]} className="px-3 py-2 text-right tabular-nums text-text-primary">
                    {formatCurrency(t)}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
