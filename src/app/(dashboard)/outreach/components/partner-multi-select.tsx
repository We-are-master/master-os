"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Search, X, ChevronDown, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Partner } from "@/types/database";

interface PartnerMultiSelectProps {
  partners: Partner[];
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
  loading?: boolean;
}

export function PartnerMultiSelect({
  partners,
  selectedIds,
  onChange,
  loading,
}: PartnerMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "onboarding" | "needs_attention">("all");
  const [tradeFilter, setTradeFilter] = useState<string>("all");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOut = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOut);
    return () => document.removeEventListener("mousedown", onClickOut);
  }, [open]);

  const availableTrades = useMemo(() => {
    const set = new Set<string>();
    for (const p of partners) {
      if (p.trade) set.add(p.trade);
    }
    return Array.from(set).sort();
  }, [partners]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return partners.filter((p) => {
      if (!p.email || !p.email.includes("@")) return false;
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (tradeFilter !== "all" && p.trade !== tradeFilter) return false;
      if (!term) return true;
      const haystack = `${p.company_name ?? ""} ${p.contact_name ?? ""} ${p.email ?? ""} ${p.trade ?? ""}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [partners, search, statusFilter, tradeFilter]);

  const selected = useMemo(
    () => partners.filter((p) => selectedIds.has(p.id)),
    [partners, selectedIds],
  );

  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const selectAllFiltered = () => {
    const next = new Set(selectedIds);
    for (const p of filtered) next.add(p.id);
    onChange(next);
  };

  const clearAll = () => onChange(new Set());

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full min-h-10 flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] text-sm text-left hover:border-border transition-colors"
      >
        <span className="flex items-center gap-2 text-text-secondary">
          <Search className="h-4 w-4" />
          {selected.length === 0
            ? "Selecionar partners..."
            : `${selected.length} partner${selected.length > 1 ? "s" : ""} selecionado${selected.length > 1 ? "s" : ""}`}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-text-tertiary transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-xl border border-border-light bg-card shadow-lg overflow-hidden">
          <div className="p-2 border-b border-border-light space-y-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, empresa, e-mail..."
              className="w-full h-8 px-2.5 text-xs rounded-md border border-border-light bg-surface-secondary focus:outline-none focus:ring-1 focus:ring-primary/30"
              autoFocus
            />
            <div className="flex items-center gap-1.5 overflow-x-auto">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="h-7 px-2 text-[11px] rounded-md border border-border-light bg-surface-secondary focus:outline-none"
              >
                <option value="all">Todos os status</option>
                <option value="active">Ativos</option>
                <option value="inactive">Inativos</option>
                <option value="onboarding">Onboarding</option>
                <option value="needs_attention">Precisa atenção</option>
              </select>
              {availableTrades.length > 0 && (
                <select
                  value={tradeFilter}
                  onChange={(e) => setTradeFilter(e.target.value)}
                  className="h-7 px-2 text-[11px] rounded-md border border-border-light bg-surface-secondary focus:outline-none"
                >
                  <option value="all">Todas as áreas</option>
                  {availableTrades.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              )}
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  disabled={filtered.length === 0}
                  className="text-[11px] text-primary hover:underline disabled:opacity-40"
                >
                  Selecionar todos ({filtered.length})
                </button>
              </div>
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {loading && (
              <div className="px-3 py-6 text-center text-xs text-text-tertiary">
                Carregando partners...
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-text-tertiary">
                Nenhum partner encontrado
              </div>
            )}
            {!loading &&
              filtered.map((p) => {
                const checked = selectedIds.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-surface-hover transition-colors"
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded border flex items-center justify-center shrink-0",
                        checked
                          ? "bg-primary border-primary text-white"
                          : "border-border-light",
                      )}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-text-primary truncate">
                        {p.company_name || p.contact_name}
                      </div>
                      <div className="text-[11px] text-text-tertiary truncate">
                        {p.contact_name} · {p.email} · {p.trade}
                      </div>
                    </div>
                    <Badge
                      variant={
                        p.status === "active"
                          ? "success"
                          : p.status === "needs_attention"
                            ? "warning"
                            : p.status === "onboarding"
                              ? "info"
                              : "default"
                      }
                      size="sm"
                    >
                      {p.status}
                    </Badge>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 text-xs rounded-md bg-primary/10 text-primary border border-primary/20"
            >
              <span className="max-w-[180px] truncate">{p.company_name || p.contact_name}</span>
              <button
                type="button"
                onClick={() => toggle(p.id)}
                className="h-4 w-4 inline-flex items-center justify-center rounded hover:bg-primary/20"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {selected.length > 3 && (
            <button
              type="button"
              onClick={clearAll}
              className="text-[11px] text-text-tertiary hover:text-text-primary underline ml-1"
            >
              Limpar todos
            </button>
          )}
        </div>
      )}
    </div>
  );
}
