"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  catalogServiceIdForTypeOfWorkLabel,
  typeOfWorkLabelsFromCatalog,
} from "@/lib/type-of-work";
import { resolveServiceDisplayIcon } from "@/lib/service-display-icons";
import type { CatalogService } from "@/types/database";

export type TypeOfWorkPickerChangeMeta = {
  catalogServiceId: string | null;
  service: CatalogService | null;
};

type BaseProps = {
  label?: string;
  hideLabel?: boolean;
  catalog: CatalogService[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  /** Applied to the trigger when value is empty (e.g. required field border). */
  emptyClassName?: string;
  labelClassName?: string;
  /** Legacy value kept in the list when editing (defaults to current value). */
  currentFallback?: string | null;
  "aria-label"?: string;
};

type LabelModeProps = BaseProps & {
  valueMode?: "label";
  value: string;
  onChange: (value: string, meta: TypeOfWorkPickerChangeMeta) => void;
};

type CatalogIdModeProps = BaseProps & {
  valueMode: "catalogId";
  value: string;
  onChange: (catalogServiceId: string, meta: TypeOfWorkPickerChangeMeta) => void;
};

export type TypeOfWorkPickerProps = LabelModeProps | CatalogIdModeProps;

function catalogRowForLabel(label: string, catalog: CatalogService[]): CatalogService | null {
  const id = catalogServiceIdForTypeOfWorkLabel(label, catalog);
  if (!id) return null;
  return catalog.find((c) => c.id === id) ?? null;
}

export function TypeOfWorkPicker(props: TypeOfWorkPickerProps) {
  const {
    label = "Type of Work *",
    hideLabel = false,
    catalog,
    disabled = false,
    className,
    placeholder = "Select type of work...",
    searchPlaceholder = "Search type of work...",
    emptyClassName,
    labelClassName = "text-[11px] font-medium text-text-secondary",
    currentFallback,
    "aria-label": ariaLabel,
  } = props;

  const valueMode = props.valueMode ?? "label";
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const currentForLabelList =
    valueMode === "label" ? props.value : (currentFallback ?? null);
  const labelOptions = useMemo(
    () => typeOfWorkLabelsFromCatalog(catalog, currentForLabelList),
    [catalog, currentForLabelList],
  );

  const catalogIdOptions = useMemo(() => {
    const rows = [...catalog].filter((c) => (c.name ?? "").trim());
    rows.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }));
    return rows;
  }, [catalog]);

  const filteredLabelOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return labelOptions;
    return labelOptions.filter((name) => name.toLowerCase().includes(q));
  }, [labelOptions, search]);

  const filteredCatalogOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalogIdOptions;
    return catalogIdOptions.filter((c) => (c.name ?? "").toLowerCase().includes(q));
  }, [catalogIdOptions, search]);

  const selectedLabel = useMemo(() => {
    if (valueMode === "catalogId") {
      const row = catalog.find((c) => c.id === props.value);
      return row?.name?.trim() ?? "";
    }
    return props.value.trim();
  }, [valueMode, catalog, props.value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const emitLabel = (name: string) => {
    if (valueMode !== "label") return;
    const service = catalogRowForLabel(name, catalog);
    props.onChange(name, {
      catalogServiceId: service?.id ?? catalogServiceIdForTypeOfWorkLabel(name, catalog),
      service,
    });
  };

  const emitCatalogId = (id: string) => {
    if (valueMode !== "catalogId") return;
    const service = id ? catalog.find((c) => c.id === id) ?? null : null;
    props.onChange(id, { catalogServiceId: id || null, service });
  };

  const optionsEmpty =
    valueMode === "catalogId" ? filteredCatalogOptions.length === 0 : filteredLabelOptions.length === 0;

  return (
    <div ref={rootRef} className={cn("relative min-w-0", className)}>
      {!hideLabel && label ? (
        <p className={cn("mb-1", labelClassName)}>{label}</p>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel ?? (hideLabel ? label : undefined)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
        className={cn(
          "h-9 w-full rounded-lg border bg-card px-3 text-left text-sm flex items-center justify-between gap-2",
          !selectedLabel && "text-text-tertiary",
          selectedLabel ? "border-border text-text-primary" : emptyClassName ?? "border-border",
          disabled && "opacity-60 cursor-not-allowed",
        )}
      >
        <span className="truncate">{selectedLabel || placeholder}</span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-text-tertiary transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 w-full rounded-lg border border-border bg-card shadow-lg p-2 space-y-2"
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-text-tertiary" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 pl-8"
              autoFocus
            />
          </div>
          <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
            {valueMode === "catalogId"
              ? filteredCatalogOptions.map((row) => {
                  const name = row.name?.trim() ?? "";
                  const { Icon } = resolveServiceDisplayIcon({ tradeLabel: name, catalogService: row });
                  const active = props.value === row.id;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        emitCatalogId(row.id);
                        setOpen(false);
                        setSearch("");
                      }}
                      className={cn(
                        "w-full rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors inline-flex items-center gap-1.5",
                        active
                          ? "bg-[#1a1a1a] text-white border-[#1a1a1a]"
                          : "bg-[#fafaf8] border-[#e0ddd8] text-[#555] hover:bg-surface-hover",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{name}</span>
                    </button>
                  );
                })
              : filteredLabelOptions.map((name) => {
                  const service = catalogRowForLabel(name, catalog);
                  const { Icon } = resolveServiceDisplayIcon({
                    tradeLabel: name,
                    catalogService: service,
                  });
                  const active = props.value === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        emitLabel(name);
                        setOpen(false);
                        setSearch("");
                      }}
                      className={cn(
                        "w-full rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors inline-flex items-center gap-1.5",
                        active
                          ? "bg-[#1a1a1a] text-white border-[#1a1a1a]"
                          : "bg-[#fafaf8] border-[#e0ddd8] text-[#555] hover:bg-surface-hover",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{name}</span>
                    </button>
                  );
                })}
            {optionsEmpty ? (
              <p className="px-2 py-2 text-xs text-text-tertiary">No work types found.</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
