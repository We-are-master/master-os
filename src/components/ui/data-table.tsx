"use client";

import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { staggerContainer, tableRowVariant } from "@/lib/motion";
import { ChevronLeft, ChevronRight, Minus } from "lucide-react";

export interface Column<T> {
  key: string;
  label: string;
  width?: string;
  minWidth?: string;
  sortable?: boolean;
  align?: "left" | "center" | "right";
  headerClassName?: string;
  cellClassName?: string;
  render?: (item: T, index: number) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (item: T) => void;
  selectedId?: string;
  getRowId?: (item: T) => string;
  emptyMessage?: string;
  emptyIcon?: React.ReactNode;
  loading?: boolean;
  page?: number;
  totalPages?: number;
  totalItems?: number;
  pageSize?: number;
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
  onPageChange?: (page: number) => void;
  className?: string;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  bulkActions?: React.ReactNode;
  /** Applied to the inner `<table>` so wide tables scroll horizontally instead of crushing cells. */
  tableClassName?: string;
}

function Checkbox({ checked, indeterminate, onChange, className }: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      className={cn(
        "h-4.5 w-4.5 rounded-md border-2 flex items-center justify-center transition-all shrink-0",
        checked || indeterminate
          ? "bg-primary border-primary text-white"
          : "border-border hover:border-text-tertiary bg-card",
        className
      )}
      style={{ height: 18, width: 18 }}
    >
      {checked && (
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {indeterminate && !checked && (
        <Minus className="h-3 w-3" />
      )}
    </button>
  );
}

export function DataTable<T>({
  columns,
  data,
  onRowClick,
  selectedId,
  getRowId,
  emptyMessage = "No data found",
  loading = false,
  page = 1,
  totalPages,
  totalItems,
  pageSize = 10,
  pageSizeOptions,
  onPageSizeChange,
  onPageChange,
  className,
  selectable = false,
  selectedIds,
  onSelectionChange,
  bulkActions,
  tableClassName,
}: DataTableProps<T>) {
  const allIds = data.map((item, i) => getRowId?.(item) ?? String(i));
  const allSelected = selectable && allIds.length > 0 && allIds.every((id) => selectedIds?.has(id));
  const someSelected = selectable && allIds.some((id) => selectedIds?.has(id));
  const selectionCount = selectedIds?.size ?? 0;

  const toggleAll = () => {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(allIds));
    }
  };

  const toggleOne = (id: string) => {
    if (!onSelectionChange || !selectedIds) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  return (
    <div className={cn("bg-card rounded-xl border border-card-border shadow-soft overflow-hidden relative", className)}>
      <AnimatePresence>
        {selectable && selectionCount > 0 && bulkActions && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="sticky top-0 z-10 flex items-center gap-3 px-5 py-2.5 bg-primary/[0.04] border-b border-primary/10"
          >
            <div className="flex items-center gap-2">
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected && !allSelected}
                onChange={toggleAll}
              />
              <span className="text-sm font-medium text-primary">
                {selectionCount} selected
              </span>
            </div>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-1.5">
              {bulkActions}
            </div>
            <button
              onClick={() => onSelectionChange?.(new Set())}
              className="ml-auto text-xs font-medium text-text-tertiary hover:text-text-secondary transition-colors"
            >
              Clear selection
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="overflow-x-auto -mx-px sm:mx-0">
        <table className={cn("w-full min-w-[1080px]", tableClassName)}>
          <thead>
            <tr className="border-b border-border-light">
              {selectable && (
                <th className="w-12 px-3 sm:px-4 py-3">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected && !allSelected}
                    onChange={toggleAll}
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{
                    /** Prefer minWidth so header text stays one line; horizontal scroll handles overflow. */
                    minWidth: col.minWidth ?? col.width,
                  }}
                  className={cn(
                    "px-3 sm:px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary whitespace-nowrap",
                    col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left",
                    col.headerClassName
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <AnimatePresence mode="wait">
            {loading ? (
              <tbody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border-light/50">
                    {selectable && (
                      <td className="px-3 sm:px-4 py-4">
                        <div className="h-4 w-4 bg-surface-tertiary rounded animate-shimmer" />
                      </td>
                    )}
                    {columns.map((col, j) => (
                      <td key={col.key} className="px-3 sm:px-5 py-4">
                        {/* Deterministic width: Math.random() breaks SSR/client hydration */}
                        <div
                          className="h-4 bg-surface-tertiary rounded animate-shimmer"
                          style={{ width: `${56 + ((i * 17 + j * 13 + col.key.length * 3) % 34)}%` }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ) : data.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="h-12 w-12 rounded-xl bg-surface-tertiary flex items-center justify-center">
                        <svg className="h-6 w-6 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                        </svg>
                      </div>
                      <p className="text-sm font-medium text-text-secondary">{emptyMessage}</p>
                    </div>
                  </td>
                </tr>
              </tbody>
            ) : (
              <motion.tbody
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
              >
                {data.map((item, index) => {
                  const id = getRowId?.(item) ?? String(index);
                  const isRowSelected = selectedId === id;
                  const isChecked = selectedIds?.has(id) ?? false;

                  return (
                    <motion.tr
                      key={id}
                      variants={tableRowVariant}
                      onClick={() => onRowClick?.(item)}
                      className={cn(
                        "border-b border-border-light/50 transition-colors duration-150",
                        onRowClick && "cursor-pointer",
                        isChecked
                          ? "bg-primary/[0.04]"
                          : isRowSelected
                            ? "bg-primary/[0.03] border-l-[3px] border-l-primary"
                            : "hover:bg-surface-hover border-l-[3px] border-l-transparent"
                      )}
                    >
                      {selectable && (
                        <td className="w-12 px-3 sm:px-4 py-3.5">
                          <Checkbox checked={isChecked} onChange={() => toggleOne(id)} />
                        </td>
                      )}
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          style={{ minWidth: col.minWidth ?? col.width }}
                          className={cn(
                            "px-3 sm:px-5 py-3.5 text-sm align-top",
                            col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left",
                            col.cellClassName
                          )}
                        >
                          {col.render
                            ? col.render(item, index)
                            : String((item as Record<string, unknown>)[col.key] ?? "")}
                        </td>
                      ))}
                    </motion.tr>
                  );
                })}
              </motion.tbody>
            )}
          </AnimatePresence>
        </table>
      </div>

      {(totalPages && totalPages > 1) || (onPageSizeChange && totalItems != null) ? (
        <div className="flex items-center justify-between px-5 py-3 border-t border-border-light">
          <p className="text-xs text-text-tertiary">
            Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, totalItems ?? 0)} of {totalItems}
          </p>
          <div className="flex items-center gap-3">
            {onPageSizeChange && (pageSizeOptions?.length ?? 0) > 0 ? (
              <label className="flex items-center gap-1.5 text-xs text-text-tertiary">
                <span>Rows</span>
                <select
                  value={pageSize}
                  onChange={(e) => onPageSizeChange(Number(e.target.value))}
                  className="h-8 rounded-lg border border-border bg-card px-2 text-xs text-text-secondary"
                >
                  {pageSizeOptions!.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {totalPages && totalPages > 1 ? (
            <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange?.(page - 1)}
              disabled={page <= 1}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => {
              const pageNum = i + 1;
              return (
                <button
                  key={pageNum}
                  onClick={() => onPageChange?.(pageNum)}
                  className={cn(
                    "h-8 w-8 rounded-lg text-xs font-medium transition-colors",
                    page === pageNum
                      ? "bg-primary text-white"
                      : "text-text-secondary hover:bg-surface-tertiary"
                  )}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => onPageChange?.(page + 1)}
              disabled={page >= totalPages}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-tertiary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
