"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { catalogServiceIdsForTradeLabels } from "@/lib/catalog-trade-ids";
import { tradeCategoryCatalogRows } from "@/lib/partner-trade-categories";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
import { updatePartner } from "@/services/partners";
import { getSupabase } from "@/services/base";
import type { Account, CatalogService, Partner } from "@/types/database";
import { resolveServiceDisplayIcon } from "@/lib/service-display-icons";

type PartnerMode = {
  kind: "partner";
  partner: Partner;
  onPartnerUpdate: (p: Partner) => void;
};

type AccountMode = {
  kind: "account";
  account: Account;
  onAccountUpdate: (a: Account) => void;
};

type Props = (PartnerMode | AccountMode) & { canEdit?: boolean };

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
        checked ? "bg-[#ED4B00]" : "bg-[#D8D8DD]",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}

export function CatalogTradesSkillsTab(props: Props) {
  const canEdit = props.canEdit !== false;
  const [catalog, setCatalog] = useState<CatalogService[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(() => new Set());
  const [primaryId, setPrimaryId] = useState<string | null>(null);

  const tradeRows = useMemo(() => tradeCategoryCatalogRows(catalog), [catalog]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listCatalogServicesForPicker()
      .then((rows) => {
        if (cancelled) return;
        setCatalog(rows);
        const categories = tradeCategoryCatalogRows(rows);
        if (props.kind === "partner") {
          const p = props.partner;
          const labels = p.trades?.length ? p.trades : p.trade?.trim() ? [p.trade] : [];
          const ids = new Set<string>();
          for (const id of p.catalog_service_ids ?? []) {
            if (id?.trim()) ids.add(id.trim());
          }
          for (const label of labels) {
            const row = categories.find(
              (c) => (c.name ?? "").trim().toLowerCase() === label.trim().toLowerCase(),
            );
            if (row) ids.add(row.id);
          }
          setEnabledIds(ids);
          const primaryLabel = labels[0]?.trim();
          const primaryRow = primaryLabel
            ? categories.find((c) => (c.name ?? "").trim() === primaryLabel)
            : categories.find((c) => ids.has(c.id));
          setPrimaryId(primaryRow?.id ?? (ids.size ? [...ids][0] : null));
        } else {
          const ids = new Set((props.account.catalog_service_ids ?? []).map((id) => id.trim()).filter(Boolean));
          setEnabledIds(ids);
          setPrimaryId(ids.size ? [...ids][0] : null);
        }
      })
      .catch(() => toast.error("Failed to load service catalogue"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.kind, props.kind === "partner" ? props.partner.id : props.account.id]);

  const toggleTrade = (id: string, on: boolean) => {
    setEnabledIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else {
        next.delete(id);
        if (primaryId === id) setPrimaryId(null);
      }
      return next;
    });
  };

  const makePrimary = (id: string) => {
    setEnabledIds((prev) => new Set(prev).add(id));
    setPrimaryId(id);
  };

  async function handleSave() {
    if (!canEdit) return;
    if (enabledIds.size === 0) {
      toast.error("Enable at least one trade.");
      return;
    }
    const orderedIds = tradeRows.filter((r) => enabledIds.has(r.id)).map((r) => r.id);
    const labels = tradeRows
      .filter((r) => enabledIds.has(r.id))
      .map((r) => r.name.trim())
      .filter(Boolean);
    const primary =
      primaryId && enabledIds.has(primaryId)
        ? tradeRows.find((r) => r.id === primaryId)?.name?.trim()
        : labels[0];
    const primaryFirst = primary
      ? [primary, ...labels.filter((l) => l !== primary)]
      : labels;

    setSaving(true);
    try {
      if (props.kind === "partner") {
        const catalogIds = catalogServiceIdsForTradeLabels(primaryFirst, catalog);
        const updated = await updatePartner(props.partner.id, {
          trades: primaryFirst,
          trade: primaryFirst[0] ?? props.partner.trade,
          catalog_service_ids: catalogIds,
        });
        props.onPartnerUpdate(updated);
        toast.success("Trades saved");
      } else {
        const supabase = getSupabase();
        const catalogIds = catalogServiceIdsForTradeLabels(primaryFirst, catalog);
        const { data, error } = await supabase
          .from("accounts")
          .update({ catalog_service_ids: catalogIds })
          .eq("id", props.account.id)
          .select()
          .single();
        if (error) throw error;
        props.onAccountUpdate(data as Account);
        toast.success("Services saved");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-text-tertiary">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading trades…
      </div>
    );
  }

  if (tradeRows.length === 0) {
    return (
      <div className="p-6 text-sm text-text-tertiary text-center">
        No trade categories in Settings → Services yet. Add services there — they appear here automatically.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h3 className="text-base font-bold text-text-primary">Trades &amp; skills</h3>
        <p className="text-xs text-text-tertiary mt-1">
          What this {props.kind === "partner" ? "partner" : "account"} does. We only send work matching enabled
          trades. New rows from Settings → Services show up here automatically.
        </p>
      </div>

      <div className="rounded-xl border border-border-light bg-card p-4 space-y-3 @container">
        <p className="text-sm font-semibold text-text-primary">Trades</p>
        <div className="grid grid-cols-1 @md:grid-cols-2 gap-3">
          {tradeRows.map((row) => {
            const on = enabledIds.has(row.id);
            const isPrimary = primaryId === row.id && on;
            const { Icon } = resolveServiceDisplayIcon({ tradeLabel: row.name, catalogService: row });
            return (
              <div
                key={row.id}
                className={cn(
                  "rounded-xl border p-3 flex flex-col gap-3 min-h-[88px]",
                  on ? "border-[#ED4B00]/40 bg-[#FFF8F5]" : "border-border-light bg-surface",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
                    <span className="text-sm font-semibold text-text-primary truncate">{row.name}</span>
                  </div>
                  <Toggle
                    checked={on}
                    disabled={!canEdit}
                    label={`${on ? "Disable" : "Enable"} ${row.name}`}
                    onChange={(v) => toggleTrade(row.id, v)}
                  />
                </div>
                {on && canEdit ? (
                  <button
                    type="button"
                    onClick={() => makePrimary(row.id)}
                    className={cn(
                      "text-left text-xs font-medium transition-colors",
                      isPrimary ? "text-[#ED4B00]" : "text-[#ED4B00]/80 hover:text-[#ED4B00]",
                    )}
                  >
                    {isPrimary ? "Primary trade" : "Make primary"}
                  </button>
                ) : (
                  <span className="text-[10px] text-text-tertiary">Off</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {canEdit ? (
        <div className="flex justify-end gap-2 pt-2 border-t border-border-light">
          <Button type="button" loading={saving} onClick={() => void handleSave()}>
            Save trades
          </Button>
        </div>
      ) : null}
    </div>
  );
}
