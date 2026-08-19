"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/input";
import { KpiCard, Pill } from "@/components/fx/primitives";
import { useProfile } from "@/hooks/use-profile";
import { listPricebook, updatePricebookLine, type PricebookLine } from "@/services/pricing";
import { formatCurrency, cn } from "@/lib/utils";

/**
 * O pricebook de LABOUR: preço exato por serviço, aprovado pelo dono.
 *
 * A regra que esta tela serve (17/08/2026): handyman é o único serviço por
 * tempo e usa a régua do catálogo; todo o resto é preço POR SERVIÇO; material
 * nunca entra aqui (vive na aba Materials). Override sempre ganha do preço da
 * fórmula, e só linha aprovada é cotada por Mike, pelo agente do Zendesk e
 * pelo price-check.
 */

const TRADE_LABELS: Record<string, string> = {
  handyman_time: "Handyman · time (the only hourly pricing)",
  handyman: "Handyman · per job",
  painter: "Painting",
  carpenter: "Carpentry",
  flooring: "Flooring",
  tiler: "Tiling",
  plasterer: "Plastering",
  paving: "Paving",
  fencing: "Fencing",
  decking: "Decking",
  garden: "Garden",
  plumber: "Plumbing",
  certificates: "Certificates",
};
const TRADE_ORDER = Object.keys(TRADE_LABELS);

const UNIT_LABELS: Record<string, string> = {
  per_job: "per job",
  per_hour: "per hour",
  per_half_day: "half day",
  per_day: "full day",
  per_item: "per item",
  per_door: "per door",
  per_window: "per window",
  per_room: "per room",
  per_m2: "per m²",
  per_panel: "per panel",
  per_post: "per post",
  per_load: "per load",
};

function StatusPill({ status }: { status: PricebookLine["status"] }) {
  if (status === "approved") return <Pill tone="ok">Approved</Pill>;
  if (status === "retired") return <Pill tone="ghost">Retired</Pill>;
  return <Pill tone="warn">Draft</Pill>;
}

function OverrideEditor({
  line,
  onSaved,
}: {
  line: PricebookLine;
  onSaved: (id: string, override: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (override: number | null) => {
    setSaving(true);
    try {
      await updatePricebookLine(line.id, { override_gbp: override });
      onSaved(line.id, override);
      setEditing(false);
    } catch (err) {
      alert(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 text-text-tertiary transition-colors hover:text-text-primary"
        title={line.override_gbp != null ? "Change or clear the override" : "Override this price"}
        onClick={() => {
          setValue(String(line.override_gbp ?? line.price_gbp));
          setEditing(true);
        }}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden />
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        min="0"
        step="1"
        autoFocus
        className="w-20 rounded-md border border-fx-line bg-card px-2 py-1 text-right text-sm"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save(Number(value));
          if (e.key === "Escape") setEditing(false);
        }}
        disabled={saving}
      />
      <button
        type="button"
        className="text-fx-green disabled:opacity-50"
        title="Save override"
        disabled={saving || value === "" || Number.isNaN(Number(value))}
        onClick={() => void save(Number(value))}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </button>
      {line.override_gbp != null && (
        <button
          type="button"
          className="text-text-tertiary hover:text-fx-coral"
          title="Clear override (back to the formula price)"
          disabled={saving}
          onClick={() => void save(null)}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </span>
  );
}

export function LabourPricebookView() {
  const { profile } = useProfile();
  const [lines, setLines] = useState<PricebookLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    listPricebook()
      .then(setLines)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const patchLine = useCallback((id: string, patch: Partial<PricebookLine>) => {
    setLines((prev) => prev?.map((l) => (l.id === id ? { ...l, ...patch } : l)) ?? prev);
  }, []);

  const approve = useCallback(
    async (line: PricebookLine) => {
      const approved_by = profile?.full_name ?? "dashboard";
      const approved_at = new Date().toISOString();
      try {
        await updatePricebookLine(line.id, { status: "approved", approved_by, approved_at });
        patchLine(line.id, { status: "approved", approved_by, approved_at });
      } catch (err) {
        alert(`Could not approve: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [profile, patchLine],
  );

  const grouped = useMemo(() => {
    if (!lines) return [];
    const q = search.trim().toLowerCase();
    const visible = q
      ? lines.filter((l) => `${l.trade} ${l.service} ${l.basis}`.toLowerCase().includes(q))
      : lines;
    const byTrade = new Map<string, PricebookLine[]>();
    for (const l of visible) {
      const list = byTrade.get(l.trade);
      if (list) list.push(l);
      else byTrade.set(l.trade, [l]);
    }
    return [...byTrade.entries()].sort(
      ([a], [b]) =>
        (TRADE_ORDER.indexOf(a) + 99 || 999) - (TRADE_ORDER.indexOf(b) + 99 || 999) ||
        a.localeCompare(b),
    );
  }, [lines, search]);

  const kpis = useMemo(() => {
    const all = lines ?? [];
    const approved = all.filter((l) => l.status === "approved").length;
    const overrides = all.filter((l) => l.override_gbp != null).length;
    return { total: all.length, approved, drafts: all.length - approved, overrides };
  }, [lines]);

  if (error) {
    return (
      <div className="rounded-xl border border-fx-line bg-card p-8 text-center text-sm text-text-secondary">
        Could not load the pricebook: {error}
        <br />
        If the table does not exist yet, apply migration 255_service_pricebook.sql first.
      </div>
    );
  }
  if (!lines) {
    return (
      <div className="flex items-center justify-center py-20 text-text-tertiary">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Services priced" value={kpis.total} sub="labour only — materials live in the next tab" />
        <KpiCard label="Approved" value={<span className="text-fx-green">{kpis.approved}</span>} sub="only approved lines are quoted" />
        <KpiCard label="Drafts" variant={kpis.drafts > 0 ? "alert" : undefined} value={kpis.drafts} sub="waiting for owner approval" />
        <KpiCard label="Overrides" value={kpis.overrides} sub="owner price beats the formula" />
      </div>

      <div className="flex justify-end">
        <SearchInput
          placeholder="Search services…"
          className="w-full sm:w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {grouped.map(([trade, tradeLines]) => (
        <div key={trade} className="space-y-2">
          <h3 className="text-sm font-semibold text-text-primary">
            {TRADE_LABELS[trade] ?? trade}
            <span className="ml-2 font-normal text-text-tertiary">{tradeLines.length}</span>
          </h3>
          <div className="overflow-x-auto rounded-xl border border-fx-line bg-card">
            <table className="fx-tbl">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Unit</th>
                  <th className="fx-tbl__num">Price</th>
                  <th className="fx-tbl__num">Min charge</th>
                  <th>Where it came from</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tradeLines.map((line) => {
                  const effective = line.override_gbp ?? line.price_gbp;
                  return (
                    <tr key={line.id}>
                      <td className="font-medium">{line.service}</td>
                      <td className="whitespace-nowrap text-text-secondary">
                        {UNIT_LABELS[line.unit] ?? line.unit}
                      </td>
                      <td className="fx-tbl__num whitespace-nowrap">
                        <span className={cn("font-semibold", line.override_gbp != null && "text-fx-green")}>
                          {formatCurrency(effective)}
                        </span>
                        {line.override_gbp != null && (
                          <span
                            className="ml-1 text-xs text-text-tertiary line-through"
                            title="Formula price, replaced by the override"
                          >
                            {formatCurrency(line.price_gbp)}
                          </span>
                        )}
                      </td>
                      <td className="fx-tbl__num whitespace-nowrap text-text-secondary">
                        {line.min_charge_gbp != null ? formatCurrency(line.min_charge_gbp) : "·"}
                      </td>
                      <td className="max-w-[340px] truncate text-xs text-text-tertiary" title={line.basis}>
                        {line.basis}
                      </td>
                      <td>
                        <StatusPill status={line.status} />
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <span className="inline-flex items-center gap-2">
                          <OverrideEditor line={line} onSaved={(id, o) => patchLine(id, { override_gbp: o })} />
                          {line.status === "draft" && (
                            <Button size="sm" variant="secondary" onClick={() => void approve(line)}>
                              Approve
                            </Button>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
