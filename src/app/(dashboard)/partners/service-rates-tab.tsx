"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { pricingModeLabel } from "@/lib/pricing-mode-labels";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
import {
  listPartnerServicePrices,
  upsertPartnerServicePrice,
  deletePartnerServicePrice,
} from "@/services/partner-service-prices";
import type {
  CatalogPresetOverridesMap,
  CatalogService,
  Partner,
  PartnerServicePrice,
} from "@/types/database";
import { catalogServiceIdsForTradeLabels, filterCatalogServicesForPartner } from "@/lib/catalog-trade-ids";
import {
  mergeCatalogWithPricingPreset,
  parsePricingAddons,
  parsePricingPresets,
  presetPricingMode,
  sortPricingAddonsDisplay,
  sortPricingPresetsDisplay,
} from "@/lib/catalog-pricing-presets";

/**
 * Per-partner override of what we PAY this partner per catalog service.
 * Includes catalogue base + pricing preset / add-on rows when the service defines them.
 */
export function PartnerServiceRatesTabSection({
  partnerId,
  partner,
}: {
  partnerId: string;
  partner: Pick<Partner, "catalog_service_ids" | "trades" | "trade">;
}) {
  const [services, setServices] = useState<CatalogService[]>([]);
  const [overrides, setOverrides] = useState<Map<string, PartnerServicePrice>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
    });
    Promise.all([
      listCatalogServicesForPicker(),
      listPartnerServicePrices(partnerId),
    ])
      .then(([cat, ovr]) => {
        if (cancelled) return;
        const offered = filterCatalogServicesForPartner(cat, partner);
        setServices(offered);
        const m = new Map<string, PartnerServicePrice>();
        for (const o of ovr) m.set(o.catalog_service_id, o);
        setOverrides(m);
        const initial: Record<string, RowDraft> = {};
        for (const s of offered) {
          initial[s.id] = draftFromPartnerService(s, m.get(s.id) ?? null);
        }
        setDrafts(initial);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load partner rates"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [partnerId, partner.catalog_service_ids, partner.trades, partner.trade]);

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
      preset_overrides: draft.use_standard ? {} : serializePartnerItemOverrides(draft.preset_overrides),
      addon_overrides: draft.use_standard ? {} : serializePartnerItemOverrides(draft.addon_overrides),
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
      [service.id]: draftFromPartnerService(service, null),
    }));
  }

  const rows = useMemo(() => {
    return services.map((s) => ({
      service: s,
      override: overrides.get(s.id) ?? null,
      draft: drafts[s.id] ?? draftFromPartnerService(s, null),
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
    const hasTradeHints =
      (partner.catalog_service_ids?.filter(Boolean).length ?? 0) > 0 ||
      (partner.trades?.length ? partner.trades : partner.trade?.trim() ? [partner.trade] : []).length > 0;
    return (
      <div className="rounded-xl border border-dashed border-border-light p-8 text-center text-sm text-text-tertiary">
        {!hasTradeHints ? (
          <>
            No trades selected for this partner. Open <strong>Overview</strong> and choose which services they
            offer — only those appear here for pricing.
          </>
        ) : (
          <>
            No catalog services match this partner&apos;s profile. Check <strong>Settings → Services</strong> names
            match the trades, then save Overview again.
          </>
        )}
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
          What we PAY this partner per service they offer (profile trades + saved catalogue ids). Services with
          price bands or add-ons list each variation below when you turn off &quot;Use standard&quot;. Overrides apply
          to NEW jobs from now on.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map(({ service, override, draft }) => (
          <PartnerRateRow
            key={service.id}
            service={service}
            override={override}
            draft={draft}
            onDraftChange={(patch) =>
              setDrafts((prev) => ({
                ...prev,
                [service.id]: { ...(prev[service.id] ?? draftFromPartnerService(service, null)), ...patch },
              }))
            }
            onCommit={() => persistRow(service)}
            onResetToStandard={() => resetToStandard(service)}
          />
        ))}
      </div>
    </div>
  );
}

type ItemPartnerDraft = { partner_cost: string };

export interface RowDraft {
  use_standard: boolean;
  fixed_partner_cost: string;
  hourly_partner_rate: string;
  default_hours: string;
  notes: string;
  preset_overrides: Record<string, ItemPartnerDraft>;
  addon_overrides: Record<string, ItemPartnerDraft>;
}

function draftFromPartnerService(service: CatalogService, o: PartnerServicePrice | null): RowDraft {
  const preset_overrides: Record<string, ItemPartnerDraft> = {};
  for (const p of sortPricingPresetsDisplay(parsePricingPresets(service.pricing_presets))) {
    const v = o?.preset_overrides?.[p.id]?.partner_cost;
    preset_overrides[p.id] = { partner_cost: v != null ? String(v) : "" };
  }
  const addon_overrides: Record<string, ItemPartnerDraft> = {};
  for (const a of sortPricingAddonsDisplay(parsePricingAddons(service.pricing_addons))) {
    const v = o?.addon_overrides?.[a.id]?.partner_cost;
    addon_overrides[a.id] = { partner_cost: v != null ? String(v) : "" };
  }
  return {
    use_standard: o ? o.use_standard : true,
    fixed_partner_cost: o?.fixed_partner_cost?.toString() ?? "",
    hourly_partner_rate: o?.hourly_partner_rate?.toString() ?? "",
    default_hours: o?.default_hours?.toString() ?? "",
    notes: o?.notes ?? "",
    preset_overrides,
    addon_overrides,
  };
}

function serializePartnerItemOverrides(
  drafts: Record<string, ItemPartnerDraft>,
): CatalogPresetOverridesMap {
  const out: CatalogPresetOverridesMap = {};
  for (const [id, d] of Object.entries(drafts)) {
    const partner_cost = parseNumOrNull(d.partner_cost);
    if (partner_cost == null) continue;
    out[id] = { partner_cost };
  }
  return out;
}

function parseNumOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Catalog standard for partner side: if hourly mode, derive hourly from partner_cost / default_hours. */
function catalogPartnerHourlyRate(s: CatalogService): number | null {
  if (s.pricing_mode !== "hourly") return null;
  const pc = Number(s.partner_cost ?? 0);
  const h = Number(s.default_hours ?? 0);
  if (h <= 0) return null;
  return pc / h;
}

function catalogPresetPartnerPlaceholder(service: CatalogService, presetId: string): string {
  const eff = mergeCatalogWithPricingPreset(service, presetId);
  if (eff.pricing_mode === "hourly") {
    const hr = catalogPartnerHourlyRate(eff);
    return hr != null ? hr.toFixed(2) : "0";
  }
  return String(Number(eff.partner_cost) || 0);
}

function PartnerRateRow({
  service,
  override,
  draft,
  onDraftChange,
  onCommit,
  onResetToStandard,
}: {
  service: CatalogService;
  override: PartnerServicePrice | null;
  draft: RowDraft;
  onDraftChange: (patch: Partial<RowDraft>) => void;
  onCommit: () => void;
  onResetToStandard: () => void;
}) {
  const presets = sortPricingPresetsDisplay(parsePricingPresets(service.pricing_presets));
  const addons = sortPricingAddonsDisplay(parsePricingAddons(service.pricing_addons));
  const hasVariants = presets.length > 0 || addons.length > 0;

  const isHourly = service.pricing_mode === "hourly";
  const isCustom = !draft.use_standard;
  const hasPersistedOverride = !!override && !override.use_standard;
  const standardHourly = catalogPartnerHourlyRate(service);

  return (
    <div
      className={
        hasPersistedOverride
          ? "rounded-xl border border-amber-500/35 bg-amber-50/40 dark:bg-amber-950/15 p-3"
          : "rounded-xl border border-border-light bg-surface p-3"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-text-primary truncate">{service.name}</p>
            <Badge
              variant={isHourly ? "info" : "default"}
              size="sm"
              className="max-w-[13rem] whitespace-normal text-center leading-tight"
            >
              {pricingModeLabel(isHourly ? "hourly" : "fixed")}
            </Badge>
            {hasPersistedOverride ? (
              <Badge variant="warning" size="sm">
                Custom
              </Badge>
            ) : (
              <Badge variant="success" size="sm">
                Standard
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-text-tertiary mt-0.5">
            Catalog standard (base service):{" "}
            {isHourly ? (
              <>
                <strong>{standardHourly != null ? `${formatCurrency(standardHourly)}/h` : "—"}</strong>
                {service.default_hours ? ` · default ${service.default_hours}h` : ""}
                {" · bundle "}
                <span className="opacity-80">{formatCurrency(service.partner_cost ?? 0)}</span>
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

      {isCustom && hasVariants ? (
        <div className="mt-3 space-y-3">
          {presets.length > 0 ? (
            <div>
              <p className="text-[10px] font-semibold uppercase text-text-tertiary mb-1.5">Base options</p>
              <div className="rounded-lg border border-border-light overflow-hidden text-xs">
                <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2 bg-surface-hover/50 px-2 py-1.5 font-medium text-text-tertiary">
                  <span>Option</span>
                  <span>Partner pay (£)</span>
                </div>
                {presets.map((p) => {
                  const mode = presetPricingMode(p);
                  const catClient =
                    mode === "fixed"
                      ? Number(p.fixed_price) || 0
                      : (Number(p.hourly_rate) || 0) * (p.default_hours ?? 1);
                  const catPartner = Number(p.partner_cost) || Number(mergeCatalogWithPricingPreset(service, p.id).partner_cost) || 0;
                  const d = draft.preset_overrides[p.id] ?? { partner_cost: "" };
                  return (
                    <div
                      key={p.id}
                      className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2 px-2 py-2 border-t border-border-light items-center"
                    >
                      <div>
                        <p className="font-medium text-text-primary">{p.label}</p>
                        <p className="text-[10px] text-text-tertiary">
                          Client ref {formatCurrency(catClient)} · catalog partner {formatCurrency(catPartner)}
                        </p>
                      </div>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        value={d.partner_cost}
                        onChange={(e) =>
                          onDraftChange({
                            preset_overrides: {
                              ...draft.preset_overrides,
                              [p.id]: { ...d, partner_cost: e.target.value },
                            },
                          })
                        }
                        onBlur={onCommit}
                        placeholder={catalogPresetPartnerPlaceholder(service, p.id)}
                        className="h-8 text-xs"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          {addons.length > 0 ? (
            <div>
              <p className="text-[10px] font-semibold uppercase text-text-tertiary mb-1.5">Additionals</p>
              <div className="rounded-lg border border-border-light overflow-hidden text-xs">
                <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2 bg-surface-hover/50 px-2 py-1.5 font-medium text-text-tertiary">
                  <span>Additional</span>
                  <span>Partner pay (£)</span>
                </div>
                {addons.map((a) => {
                  const d = draft.addon_overrides[a.id] ?? { partner_cost: "" };
                  const catPartner = Number(a.partner_cost) || 0;
                  return (
                    <div
                      key={a.id}
                      className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2 px-2 py-2 border-t border-border-light items-center"
                    >
                      <div>
                        <p className="font-medium text-text-primary">{a.label}</p>
                        <p className="text-[10px] text-text-tertiary">
                          Client {formatCurrency(a.fixed_price)} · catalog partner {formatCurrency(catPartner)}
                        </p>
                      </div>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        value={d.partner_cost}
                        onChange={(e) =>
                          onDraftChange({
                            addon_overrides: {
                              ...draft.addon_overrides,
                              [a.id]: { ...d, partner_cost: e.target.value },
                            },
                          })
                        }
                        onBlur={onCommit}
                        placeholder={String(catPartner)}
                        className="h-8 text-xs"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div>
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
      ) : isCustom ? (
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

/** True when the draft differs from catalog standard (saved after partner create). */
export function partnerRateDraftHasCustomPay(draft: RowDraft): boolean {
  if (draft.use_standard) return false;
  if (parseNumOrNull(draft.fixed_partner_cost) != null) return true;
  if (parseNumOrNull(draft.hourly_partner_rate) != null) return true;
  if (parseNumOrNull(draft.default_hours) != null) return true;
  if (draft.notes.trim()) return true;
  for (const d of Object.values(draft.preset_overrides)) {
    if (parseNumOrNull(d.partner_cost) != null) return true;
  }
  for (const d of Object.values(draft.addon_overrides)) {
    if (parseNumOrNull(d.partner_cost) != null) return true;
  }
  return false;
}

export function buildPartnerServicePriceInputFromDraft(
  partnerId: string,
  catalogServiceId: string,
  draft: RowDraft,
): Omit<PartnerServicePrice, "id" | "created_at" | "updated_at" | "deleted_at" | "catalog_service_name" | "catalog_pricing_mode"> | null {
  if (!partnerRateDraftHasCustomPay(draft)) return null;
  return {
    partner_id: partnerId,
    catalog_service_id: catalogServiceId,
    use_standard: false,
    fixed_partner_cost: parseNumOrNull(draft.fixed_partner_cost),
    hourly_partner_rate: parseNumOrNull(draft.hourly_partner_rate),
    default_hours: parseNumOrNull(draft.default_hours),
    notes: draft.notes.trim() || null,
    preset_overrides: serializePartnerItemOverrides(draft.preset_overrides),
    addon_overrides: serializePartnerItemOverrides(draft.addon_overrides),
  };
}

/** Wizard step: configure pay rates before the partner row exists (applied on create). */
export function PartnerServiceRatesCreateStep({
  trades,
  catalogServices,
  drafts,
  onDraftsChange,
}: {
  trades: string[];
  catalogServices: CatalogService[];
  drafts: Record<string, RowDraft>;
  onDraftsChange: (next: Record<string, RowDraft>) => void;
}) {
  const partnerPreview = useMemo(
    () => ({
      trades,
      trade: trades[0] ?? "",
      catalog_service_ids: catalogServiceIdsForTradeLabels(trades, catalogServices),
    }),
    [trades, catalogServices],
  );

  const services = useMemo(
    () => filterCatalogServicesForPartner(catalogServices, partnerPreview),
    [catalogServices, partnerPreview],
  );

  useEffect(() => {
    const initial: Record<string, RowDraft> = { ...drafts };
    let changed = false;
    for (const s of services) {
      if (!initial[s.id]) {
        initial[s.id] = draftFromPartnerService(s, null);
        changed = true;
      }
    }
    if (changed) onDraftsChange(initial);
  }, [services]); // eslint-disable-line react-hooks/exhaustive-deps -- seed drafts when trades change

  if (trades.length === 0) {
    return (
      <p className="text-sm text-text-tertiary py-6 text-center">
        Select at least one trade on <span className="font-medium text-text-secondary">Partner info</span> to
        configure rates.
      </p>
    );
  }

  if (services.length === 0) {
    return (
      <p className="text-sm text-text-tertiary py-6 text-center max-w-md mx-auto">
        No catalog services match the selected trades. Check{" "}
        <span className="font-medium text-text-secondary">Settings → Services</span> names match your trade
        labels.
      </p>
    );
  }

  const customCount = services.filter((s) => partnerRateDraftHasCustomPay(drafts[s.id] ?? draftFromPartnerService(s, null))).length;

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-tertiary leading-relaxed">
        Optional. Uncheck &quot;Use standard&quot; to set what we pay this partner per service. Saved when you
        create the partner{customCount > 0 ? ` (${customCount} custom)` : ""}.
      </p>
      <div className="space-y-2 max-h-[min(52vh,28rem)] overflow-y-auto overscroll-contain pr-1 -mr-1">
        {services.map((service) => {
          const draft = drafts[service.id] ?? draftFromPartnerService(service, null);
          return (
            <PartnerRateRow
              key={service.id}
              service={service}
              override={null}
              draft={draft}
              onDraftChange={(patch) =>
                onDraftsChange({
                  ...drafts,
                  [service.id]: { ...draft, ...patch },
                })
              }
              onCommit={() => {}}
              onResetToStandard={() =>
                onDraftsChange({
                  ...drafts,
                  [service.id]: draftFromPartnerService(service, null),
                })
              }
            />
          );
        })}
      </div>
    </div>
  );
}
