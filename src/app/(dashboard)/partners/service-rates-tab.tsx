"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
import {
  listPartnerServicePrices,
  upsertPartnerServicePrice,
  deletePartnerServicePrice,
} from "@/services/partner-service-prices";
import type { CatalogService, PartnerServicePrice } from "@/types/database";

/**
 * Per-partner override of what we PAY this partner per catalog service.
 * Mirror of AccountServiceRatesTabSection — same UX, opposite side of P&L.
 */
export function PartnerServiceRatesTabSection({ partnerId }: { partnerId: string }) {
  const [services, setServices] = useState<CatalogService[]>([]);
  const [overrides, setOverrides] = useState<Map<string, PartnerServicePrice>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      listCatalogServicesForPicker(),
      listPartnerServicePrices(partnerId),
    ])
      .then(([cat, ovr]) => {
        if (cancelled) return;
        setServices(cat);
        const m = new Map<string, PartnerServicePrice>();
        for (const o of ovr) m.set(o.catalog_service_id, o);
        setOverrides(m);
        const initial: Record<string, RowDraft> = {};
        for (const s of cat) {
          const o = m.get(s.id);
          initial[s.id] = {
            use_standard: o ? o.use_standard : true,
            fixed_partner_cost: o?.fixed_partner_cost?.toString() ?? "",
            hourly_partner_rate: o?.hourly_partner_rate?.toString() ?? "",
            default_hours: o?.default_hours?.toString() ?? "",
            notes: o?.notes ?? "",
          };
        }
        setDrafts(initial);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load partner rates"))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [partnerId]);

  async function persistRow(service: CatalogService) {
    const draft = drafts[service.id];
    if (!draft) return;
    const payload = {
      partner_id: partnerId,
      catalog_service_id: service.id,
      use_standard: draft.use_standard,
      fixed_partner_cost: parseNumOrNull(draft.fixed_partner_cost),
      hourly_partner_rate: parseNumOrNull(draft.hourly_partner_rate),
      default_hours: parseNumOrNull(draft.default_hours),
      notes: draft.notes.trim() || null,
    };
    try {
      const saved = await upsertPartnerServicePrice(payload);
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
        await deletePartnerServicePrice(existing.id);
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
        fixed_partner_cost: "",
        hourly_partner_rate: "",
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
        <span className="text-sm">Loading partner rates…</span>
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
          <Wrench className="h-4 w-4 text-text-tertiary" />
          Service rates
        </h4>
        <p className="text-xs text-text-tertiary mt-0.5">
          What we PAY this partner per service. Toggle &quot;Custom&quot; to override the catalog default —
          affects only NEW jobs from now on.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map(({ service, override, draft }) => (
          <PartnerRateRow
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
  fixed_partner_cost: string;
  hourly_partner_rate: string;
  default_hours: string;
  notes: string;
}

function defaultDraft(): RowDraft {
  return {
    use_standard: true,
    fixed_partner_cost: "",
    hourly_partner_rate: "",
    default_hours: "",
    notes: "",
  };
}

function parseNumOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Catalog standard for partner side: if hourly mode, derive hourly_partner_rate
 *  from partner_cost / default_hours. */
function catalogPartnerHourlyRate(s: CatalogService): number | null {
  if (s.pricing_mode !== "hourly") return null;
  const pc = Number(s.partner_cost ?? 0);
  const h = Number(s.default_hours ?? 0);
  if (h <= 0) return null;
  return pc / h;
}

function PartnerRateRow({
  service, override, draft, onDraftChange, onCommit, onResetToStandard,
}: {
  service: CatalogService;
  override: PartnerServicePrice | null;
  draft: RowDraft;
  onDraftChange: (patch: Partial<RowDraft>) => void;
  onCommit: () => void;
  onResetToStandard: () => void;
}) {
  const isHourly = service.pricing_mode === "hourly";
  const isCustom = !draft.use_standard;
  const hasPersistedOverride = !!override && !override.use_standard;
  const standardHourly = catalogPartnerHourlyRate(service);

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
                <strong>{standardHourly != null ? `${formatCurrency(standardHourly)}/h` : "—"}</strong>
                {service.default_hours ? ` · default ${service.default_hours}h` : ""}
                {" · derived from "}
                <span className="opacity-80">cost {formatCurrency(service.partner_cost ?? 0)}</span>
              </>
            ) : (
              <strong>{formatCurrency(service.partner_cost ?? 0)}</strong>
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
              title="Remove this partner's override"
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
                  Hourly cost (£)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={draft.hourly_partner_rate}
                  onChange={(e) => onDraftChange({ hourly_partner_rate: e.target.value })}
                  onBlur={onCommit}
                  placeholder={standardHourly != null ? standardHourly.toFixed(2) : "0"}
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
                Fixed cost (£)
              </label>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={draft.fixed_partner_cost}
                onChange={(e) => onDraftChange({ fixed_partner_cost: e.target.value })}
                onBlur={onCommit}
                placeholder={String(service.partner_cost ?? 0)}
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
              placeholder="e.g. trial rate for 2026"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
