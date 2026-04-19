"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { staggerContainer, tableRowVariant } from "@/lib/motion";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronLeft, ChevronRight, Minus, SlidersHorizontal } from "lucide-react";

/** One entry in the column header sort menu (explicit A–Z, newest, etc.). */
export interface ColumnSortOption {
  label: string;
  /** Field to sort by; `null` clears sort (back to list default). */
  sortKey: string | null;
  direction: "asc" | "desc";
}

export interface Column<T> {
  key: string;
  label: string;
  width?: string;
  minWidth?: string;
  sortable?: boolean;
  /**
   * When set, the header opens a menu with these choices instead of cycling asc/desc.
   * If omitted but `sortable` is true, falls back to asc → desc → clear.
   */
  sortOptions?: ColumnSortOption[];
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
  /** Enables per-table column picker (saved in localStorage by key + scope). */
  columnConfigKey?: string;
  /** Optional scope (e.g. active tab id) appended to storage key. */
  columnConfigScope?: string;
  /** Client-side column sort (optional). When set, sortable columns show icons and call `onSortChange`. */
  sortColumnKey?: string | null;
  sortDirection?: "asc" | "desc";
  onSortChange?: (key: string | null, direction: "asc" | "desc") => void;
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
  columnConfigKey,
  columnConfigScope,
  sortColumnKey,
  sortDirection = "asc",
  onSortChange,
}: DataTableProps<T>) {
  const configStorageKey = columnConfigKey
    ? `${columnConfigKey}:${columnConfigScope ?? "default"}`
    : null;
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  const [openSortMenuColKey, setOpenSortMenuColKey] = useState<string | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const supportsColumnConfig = Boolean(configStorageKey) && columns.length > 1;

  useEffect(() => {
    if (!configStorageKey) {
      setHiddenColumns(new Set());
      return;
    }
    try {
      const raw = localStorage.getItem(configStorageKey);
      if (!raw) {
        setHiddenColumns(new Set());
        return;
      }
      const parsed = JSON.parse(raw) as string[];
      const allowed = new Set(columns.map((c) => c.key));
      const next = new Set((parsed ?? []).filter((k) => allowed.has(k)));
      if (next.size >= columns.length) {
        setHiddenColumns(new Set());
      } else {
        setHiddenColumns(next);
      }
    } catch {
      setHiddenColumns(new Set());
    }
  }, [configStorageKey, columns]);

  useEffect(() => {
    if (!columnMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!columnMenuRef.current) return;
      if (!columnMenuRef.current.contains(e.target as Node)) setColumnMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [columnMenuOpen]);

  useEffect(() => {
    if (!openSortMenuColKey) return;
    const onDocClick = (e: MouseEvent) => {
      if (!sortMenuRef.current?.contains(e.target as Node)) setOpenSortMenuColKey(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenSortMenuColKey(null);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [openSortMenuColKey]);

  const visibleColumns = useMemo(() => {
    if (!supportsColumnConfig) return columns;
    const next = columns.filter((c) => !hiddenColumns.has(c.key));
    return next.length > 0 ? next : columns;
  }, [columns, hiddenColumns, supportsColumnConfig]);

  const setHiddenAndPersist = (next: Set<string>) => {
    setHiddenColumns(next);
    if (!configStorageKey) return;
    try {
      localStorage.setItem(configStorageKey, JSON.stringify([...next]));
    } catch {
      // ignore
    }
  };

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

  const handleColumnSortClick = (col: Column<T>) => {
    if (!col.sortable || !onSortChange) return;
    if (col.sortOptions?.length) return;
    if (sortColumnKey !== col.key) {
      onSortChange(col.key, "asc");
      return;
    }
    if (sortDirection === "asc") {
      onSortChange(col.key, "desc");
      return;
    }
    onSortChange(null, "asc");
  };

  const applySortOption = (opt: ColumnSortOption) => {
    if (!onSortChange) return;
    if (opt.sortKey == null) onSortChange(null, "asc");
    else onSortChange(opt.sortKey, opt.direction);
    setOpenSortMenuColKey(null);
  };

  const sortOptionMatches = (opt: ColumnSortOption) => {
    if (opt.sortKey == null) return sortColumnKey == null;
    return sortColumnKey === opt.sortKey && sortDirection === opt.direction;
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

      <div className="overflow-x-auto -mx-px sm:mx-0 relative" ref={sortMenuRef}>
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
              {visibleColumns.map((col) => {
                const sortable = Boolean(col.sortable && onSortChange && col.label);
                const menuMode = Boolean(sortable && col.sortOptions?.length);
                const legacyActive = sortable && !menuMode && sortColumnKey === col.key;
                const menuActive =
                  menuMode &&
                  (col.sortOptions?.some((o) => sortOptionMatches(o)) ?? false);
                const active = legacyActive || menuActive;
                return (
                  <th
                    key={col.key}
                    style={{
                      /** Prefer minWidth so header text stays one line; horizontal scroll handles overflow. */
                      minWidth: col.minWidth ?? col.width,
                    }}
                    className={cn(
                      "px-3 sm:px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary whitespace-nowrap",
                      menuMode && "relative z-20",
                      col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left",
                      col.headerClassName
                    )}
                    aria-sort={
                      sortable && active
                        ? sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : sortable
                          ? "none"
                          : undefined
                    }
                  >
                    {sortable ? (
                      menuMode ? (
                        <div className="inline-block w-max max-w-none text-left align-middle">
                          <button
                            type="button"
                            aria-expanded={openSortMenuColKey === col.key}
                            aria-haspopup="listbox"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenSortMenuColKey((k) => (k === col.key ? null : col.key));
                            }}
                            className={cn(
                              "group inline-flex w-max max-w-none items-center gap-0.5 rounded-md -mx-1 px-1 py-0.5 -my-0.5 transition-colors hover:text-text-secondary hover:bg-surface-hover/80",
                              col.align === "right" && "ml-auto",
                              col.align === "center" && "mx-auto",
                              active && "text-text-secondary",
                            )}
                            title="Sort options"
                          >
                            <span className="shrink-0 whitespace-nowrap">{col.label}</span>
                            <span className="inline-flex shrink-0 gap-0.5 text-text-tertiary group-hover:text-text-secondary">
                              {active ? (
                                sortDirection === "asc" ? (
                                  <ArrowUp className="h-3 w-3" aria-hidden />
                                ) : (
                                  <ArrowDown className="h-3 w-3" aria-hidden />
                                )
                              ) : (
                                <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden />
                              )}
                              <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
                            </span>
                          </button>
                          {openSortMenuColKey === col.key && col.sortOptions?.length ? (
                            <ul
                              role="listbox"
                              className="absolute left-0 top-full z-50 mt-1 min-w-[13rem] max-w-[min(calc(100vw-1.5rem),18rem)] rounded-lg border border-border-light bg-card py-1 shadow-lg dark:border-border"
                            >
                              {col.sortOptions.map((opt, optIdx) => {
                                const selected = sortOptionMatches(opt);
                                return (
                                  <li key={`${col.key}-sort-${optIdx}`} role="none">
                                    <button
                                      type="button"
                                      role="option"
                                      aria-selected={selected}
                                      className={cn(
                                        "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs font-medium transition-colors hover:bg-surface-hover",
                                        selected ? "text-primary" : "text-text-secondary",
                                      )}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        applySortOption(opt);
                                      }}
                                    >
                                      <span className="min-w-0 flex-1 leading-snug">{opt.label}</span>
                                      {selected ? (
                                        <span className="shrink-0 text-[10px] font-semibold text-primary" aria-hidden>
                                          ✓
                                        </span>
                                      ) : null}
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleColumnSortClick(col)}
                          className={cn(
                            "group inline-flex w-max max-w-none items-center gap-1 rounded-md -mx-1 px-1 py-0.5 -my-0.5 transition-colors hover:text-text-secondary hover:bg-surface-hover/80",
                            col.align === "right" && "ml-auto",
                            col.align === "center" && "mx-auto",
                          )}
                          title="Sort"
                        >
                          <span className="shrink-0 whitespace-nowrap">{col.label}</span>
                          <span className="inline-flex shrink-0 text-text-tertiary group-hover:text-text-secondary">
                            {active ? (
                              sortDirection === "asc" ? (
                                <ArrowUp className="h-3 w-3" aria-hidden />
                              ) : (
                                <ArrowDown className="h-3 w-3" aria-hidden />
                              )
                            ) : (
                              <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden />
                            )}
                          </span>
                        </button>
                      )
                    ) : (
                      col.label
                    )}
                  </th>
                );
              })}
              {supportsColumnConfig ? (
                <th className="w-10 px-2 py-3 text-right relative">
                  <div className="inline-block" ref={columnMenuRef}>
                    <button
                      type="button"
                      onClick={() => setColumnMenuOpen((v) => !v)}
                      className="h-7 w-7 rounded-md inline-flex items-center justify-center text-text-tertiary hover:text-text-secondary hover:bg-surface-hover"
                      title="Choose columns"
                      aria-label="Choose table columns"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                    </button>
                    {columnMenuOpen ? (
                      <div className="absolute right-0 top-9 z-20 w-56 rounded-xl border border-border-light bg-card shadow-lg p-3 space-y-2">
                        <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Columns</p>
                        <div className="max-h-56 overflow-auto space-y-1.5">
                          {columns.map((col) => {
                            const checked = !hiddenColumns.has(col.key);
                            const visibleCount = columns.length - hiddenColumns.size;
                            const disableUncheck = checked && visibleCount <= 1;
                            return (
                              <label key={col.key} className="flex items-center gap-2 text-xs text-text-secondary">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={disableUncheck}
                                  onChange={() => {
                                    const next = new Set(hiddenColumns);
                                    if (checked) next.add(col.key);
                                    else next.delete(col.key);
                                    if (next.size >= columns.length) return;
                                    setHiddenAndPersist(next);
                                  }}
                                  className="h-4 w-4 rounded border-border"
                                />
                                <span className="truncate" title={col.label}>{col.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </th>
              ) : null}
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
                    {visibleColumns.map((col, j) => (
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
                  <td colSpan={visibleColumns.length + (selectable ? 1 : 0) + (supportsColumnConfig ? 1 : 0)} className="px-5 py-16 text-center">
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
                  const isZebra = !isChecked && !isRowSelected && index % 2 === 1;

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
                            : "hover:bg-surface-hover border-l-[3px] border-l-transparent",
                        isZebra && "bg-[#F5F5F7]"
                      )}
                    >
                      {selectable && (
                        <td className={cn("w-12 px-3 sm:px-4 py-3.5", isZebra && "bg-[#F5F5F7]")}>
                          <Checkbox checked={isChecked} onChange={() => toggleOne(id)} />
                        </td>
                      )}
                      {visibleColumns.map((col) => (
                        <td
                          key={col.key}
                          style={{ minWidth: col.minWidth ?? col.width }}
                          className={cn(
                            "px-3 sm:px-5 py-3.5 text-sm align-top",
                            col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left",
                            col.cellClassName,
                            isZebra && "bg-[#F5F5F7]"
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
