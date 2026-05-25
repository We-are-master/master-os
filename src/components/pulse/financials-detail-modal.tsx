"use client";

import Link from "next/link";

export type BreakdownColumn<R> = {
  key: string;
  label: string;
  align?: "left" | "right";
  className?: string;
  render: (row: R) => React.ReactNode;
};

export interface BreakdownTableProps<R> {
  rows: R[];
  columns: BreakdownColumn<R>[];
  totals?: React.ReactNode;
  emptyLabel?: string;
  rowHref?: (row: R) => string | null;
  onRowNavigate?: () => void;
}

export function BreakdownTable<R>({
  rows,
  columns,
  totals,
  emptyLabel = "Nothing to show in this period.",
  rowHref,
  onRowNavigate,
}: BreakdownTableProps<R>) {
  if (rows.length === 0) {
    return <div className="px-6 py-10 text-center text-sm text-fx-mute">{emptyLabel}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={
                  "sticky top-0 z-10 px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] " +
                  "text-fx-mute bg-fx-paper border-b border-fx-line whitespace-nowrap " +
                  (col.align === "right" ? "text-right" : "text-left") +
                  (col.className ? ` ${col.className}` : "")
                }
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const href = rowHref?.(row) ?? null;
            if (href) {
              return (
                <tr key={idx} className="hover:bg-fx-paper transition-colors">
                  <td colSpan={columns.length} className="p-0 border-b border-fx-line last:border-b-0">
                    <Link
                      href={href}
                      onClick={onRowNavigate}
                      className="grid w-full"
                      style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, auto))` }}
                    >
                      {columns.map((col) => (
                        <span
                          key={col.key}
                          className={
                            "px-3 py-2.5 align-middle text-text-primary " +
                            (col.align === "right" ? "text-right tabular-nums " : "") +
                            (col.className ?? "")
                          }
                        >
                          {col.render(row)}
                        </span>
                      ))}
                    </Link>
                  </td>
                </tr>
              );
            }
            return (
              <tr key={idx} className="hover:bg-fx-paper transition-colors">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={
                      "px-3 py-2.5 align-middle border-b border-fx-line last:border-b-0 " +
                      (col.align === "right" ? "text-right tabular-nums " : "") +
                      (col.className ?? "")
                    }
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        {totals && (
          <tfoot>
            <tr className="bg-fx-paper">
              <td
                colSpan={columns.length}
                className="px-3 py-2.5 text-[12px] font-medium text-text-primary border-t border-fx-line"
              >
                {totals}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
