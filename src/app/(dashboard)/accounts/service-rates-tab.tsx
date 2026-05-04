"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
import {
  listAccountServicePrices,
  upsertAccountServicePrice,
  deleteAccountServicePrice,
} from "@/services/account-service-prices";
import type { AccountServicePrice, CatalogService } from "@/types/database";

/**
 * Per-account override of what THIS account pays for each catalog service.
 * One row per service with toggle "Use standard". When custom, exposes
 * the appropriate fields based on the catalog's pricing_mode.
 */
export function AccountServiceRatesTabSection({ accountId }: { accountId: string }) {
  const [services, setServices] = useState<CatalogService[]>([]);
  const [overrides, setOverrides] = useState<Map<string, AccountServicePrice>>(() => new Map());
  const [loading, setLoading] = useState(true);
  /** Local edit buffer keyed by catalog_service_id — saved on blur. */
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      listCatalogServicesForPicker(),
      listAccountServicePrices(accountId),
    ])
      .then(([cat, ovr]) => {
        if (cancelled) return;
        setServices(cat);
        const m = new Map<string, AccountServicePrice>();
        for (const o of ovr) m.set(o.catalog_service_id, o);
        setOverrides(m);
        // Hydrate drafts from existing overrides.
        const initial: Record<string, RowDraft> = {};
        for (const s of cat) {
          const o = m.get(s.id);
          initial[s.id] = {
            use_standard: o ? o.use_standard : true,
            fixed_price: o?.fixed_price?.toString() ?? "",
            hourly_rate: o?.hourly_rate?.toString() ?? "",
            default_hours: o?.default_hours?.toString() ?? "",
            notes: o?.notes ?? "",
          };
        }
        setDrafts(initial);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load service rates"))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountId]);

  async function persistRow(service: CatalogService) {
    const draft = drafts[service.id];
    if (!draft) return;
    const payload = {
      account_id: accountId,
      catalog_service_id: service.id,
      use_standard: draft.use_standard,
      fixed_price: parseNumOrNull(draft.fixed_price),
      hourly_rate: parseNumOrNull(draft.hourly_rate),
      default_hours: parseNumOrNull(draft.default_hours),
      notes: draft.notes.trim() || null,
    };
    try {
      const saved = await upsertAccountServicePrice(payload);
      setOverrides((prev) => {
        const next = new Map(prev);
        next.set(service.id, saved);
        return next;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save rate");
    }
  }

  async function resetToStandard(service: CatalogService) {
    const existing = overrides.get(service.id);
    if (existing) {
      try {
        await deleteAccountServicePrice(existing.id);
        setOverrides((prev) => {
          const next = new Map(prev);
          next.delete(service.id);
          return next;
        });
        toast.success(`Reset "${service.name}" to standard`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to reset");
        return;
      }
    }
    setDrafts((prev) => ({
      ...prev,
      [service.id]: {
        use_standard: true,
        fixed_price: "",
        hourly_rate: "",
        default_hours: "",
        notes: "",
      },
    }));
  }

  const rows = useMemo(() => {
    return services.map((s) => ({
      service: s,
      override: overrides.get(s.id) ?? null,
      draft: drafts[s.id] ?? defaultDraft(),
    }));
  }, [services, overrides, drafts]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-tertiary">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">Loading service rates…</span>
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-light p-8 text-center text-sm text-text-tertiary">
        No catalog services. Add services in <strong>/services</strong> first.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-bold text-text-primary flex items-center gap-2">
          <Wallet className="h-4 w-4 text-text-tertiary" />
          Service rates
        </h4>
        <p className="text-xs text-text-tertiary mt-0.5">
          What THIS account pays per service. Toggle &quot;Custom&quot; to override the catalog default — affects only NEW jobs from now on.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map(({ service, override, draft }) => (
          <ServiceRateRow
            key={service.id}
            service={service}
            override={override}
            draft={draft}
            onDraftChange={(patch) => setDrafts((prev) => ({
              ...prev,
              [service.id]: { ...(prev[service.id] ?? defaultDraft()), ...patch },
            }))}
            onCommit={() => persistRow(service)}
            onResetToStandard={() => resetToStandard(service)}
          />
        ))}
      </div>
    </div>
  );
}

interface RowDraft {
  use_standard: boolean;
  fixed_price: string;
  hourly_rate: string;
  default_hours: string;
  notes: string;
}

function defaultDraft(): RowDraft {
  return { use_standard: true, fixed_price: "", hourly_rate: "", default_hours: "", notes: "" };
}

function parseNumOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function ServiceRateRow({
  service, override, draft, onDraftChange, onCommit, onResetToStandard,
}: {
  service: CatalogService;
  override: AccountServicePrice | null;
  draft: RowDraft;
  onDraftChange: (patch: Partial<RowDraft>) => void;
  onCommit: () => void;
  onResetToStandard: () => void;
}) {
  const isHourly = service.pricing_mode === "hourly";
  const isCustom = !draft.use_standard;
  const hasPersistedOverride = !!override && !override.use_standard;

  return (
    <div className={
      hasPersistedOverride
        ? "rounded-xl border border-amber-500/35 bg-amber-50/40 dark:bg-amber-950/15 p-3"
        : "rounded-xl border border-border-light bg-surface p-3"
    }>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-text-primary truncate">{service.name}</p>
            <Badge variant={isHourly ? "info" : "default"} size="sm">
              {isHourly ? "Hourly" : "Fixed"}
            </Badge>
            {hasPersistedOverride
              ? <Badge variant="warning" size="sm">Custom</Badge>
              : <Badge variant="success" size="sm">Standard</Badge>}
          </div>
          <p className="text-[11px] text-text-tertiary mt-0.5">
            Catalog standard:{" "}
            {isHourly ? (
              <>
                <strong>{formatCurrency(service.hourly_rate ?? 0)}/h</strong>
                {service.default_hours ? ` · default ${service.default_hours}h` : ""}
              </>
            ) : (
              <strong>{formatCurrency(service.fixed_price ?? 0)}</strong>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <label className="flex items-center gap-1.5 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={draft.use_standard}
              onChange={(e) => {
                onDraftChange({ use_standard: e.target.checked });
                // Persist the toggle immediately so the badge & db are in sync.
                queueMicrotask(onCommit);
              }}
              className="h-3.5 w-3.5 rounded border-border-light"
            />
            Use standard
          </label>
          {hasPersistedOverride ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw className="h-3 w-3" />}
              onClick={onResetToStandard}
              title="Remove this account's override"
            >
              Reset
            </Button>
          ) : null}
        </div>
      </div>

      {isCustom ? (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {isHourly ? (
            <>
              <div>
                <label className="block text-[10px] font-semibold text-text-tertiary uppercase mb-1">
                  Hourly rate (£)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={draft.hourly_rate}
                  onChange={(e) => onDraftChange({ hourly_rate: e.target.value })}
                  onBlur={onCommit}
                  placeholder={String(service.hourly_rate ?? 0)}
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-text-tertiary uppercase mb-1">
                  Default hours
                </label>
                <Input
                  type="number"
                  step="0.25"
                  min={0.25}
                  value={draft.default_hours}
                  onChange={(e) => onDraftChange({ default_hours: e.target.value })}
                  onBlur={onCommit}
                  placeholder={String(service.default_hours ?? 1)}
                />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-[10px] font-semibold text-text-tertiary uppercase mb-1">
                Fixed price (£)
              </label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={draft.fixed_price}
                onChange={(e) => onDraftChange({ fixed_price: e.target.value })}
                onBlur={onCommit}
                placeholder={String(service.fixed_price ?? 0)}
              />
            </div>
          )}
          <div className={isHourly ? "" : "sm:col-span-2"}>
            <label className="block text-[10px] font-semibold text-text-tertiary uppercase mb-1">
              Notes (optional)
            </label>
            <Input
              value={draft.notes}
              onChange={(e) => onDraftChange({ notes: e.target.value })}
              onBlur={onCommit}
              placeholder="e.g. agreed in May 2026"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
