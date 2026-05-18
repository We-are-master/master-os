"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { pricingModeLabel } from "@/lib/pricing-mode-labels";
import { listCatalogServicesForPicker } from "@/services/catalog-services";
import {
  listAccountServicePrices,
  upsertAccountServicePrice,
  deleteAccountServicePrice,
} from "@/services/account-service-prices";
import type {
  Account,
  AccountServicePrice,
  CatalogAddonOverridesMap,
  CatalogPresetOverridesMap,
  CatalogService,
} from "@/types/database";
import { filterCatalogServicesForAccount } from "@/lib/catalog-trade-ids";
import {
  parsePricingAddons,
  parsePricingPresets,
  presetPricingMode,
  sortPricingAddonsDisplay,
  sortPricingPresetsDisplay,
} from "@/lib/catalog-pricing-presets";
import { catalogHasStackableAddons } from "@/lib/catalog-line-pricing";

/**
 * Per-account override of what THIS account pays for each catalog service.
 * One row per service with toggle "Use standard". When custom, exposes
 * the appropriate fields based on the catalog's pricing_mode.
 */
export function AccountServiceRatesTabSection({
  accountId,
  account,
}: {
  accountId: string;
  account: Pick<Account, "catalog_service_ids">;
}) {
  const [services, setServices] = useState<CatalogService[]>([]);
  const [overrides, setOverrides] = useState<Map<string, AccountServicePrice>>(() => new Map());
  const [loading, setLoading] = useState(true);
  /** Local edit buffer keyed by catalog_service_id — saved on blur. */
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
    });
    Promise.all([
      listCatalogServicesForPicker(),
      listAccountServicePrices(accountId),
    ])
      .then(([cat, ovr]) => {
        if (cancelled) return;
        const offered = filterCatalogServicesForAccount(cat, account);
        setServices(offered);
        const m = new Map<string, AccountServicePrice>();
        for (const o of ovr) m.set(o.catalog_service_id, o);
        setOverrides(m);
        const initial: Record<string, RowDraft> = {};
        for (const s of offered) {
          const o = m.get(s.id);
          initial[s.id] = draftFromServiceAndOverride(s, o ?? null);
        }
        setDrafts(initial);
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load service rates"))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountId, account.catalog_service_ids]);

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
      preset_overrides: draft.use_standard ? {} : serializeItemOverrides(draft.preset_overrides),
      addon_overrides: draft.use_standard ? {} : serializeItemOverrides(draft.addon_overrides),
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
      [service.id]: draftFromServiceAndOverride(service, null),
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
        {(account.catalog_service_ids?.filter(Boolean).length ?? 0) === 0 ? (
          <>
            No services selected for this account. Open <strong>Overview</strong> and choose which catalogue
            services you offer them — only those appear here for pricing.
          </>
        ) : (
          <>
            No catalogue rows match the selected services. Check <strong>Settings → Services</strong>, then save
            Overview again.
          </>
        )}
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
          What THIS account pays per service they are offered (from Overview). Toggle &quot;Custom&quot; to override
          the catalog default — base options and additionals when defined. Affects only NEW jobs from now on.
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

type ItemOverrideDraft = { fixed_price: string; partner_cost: string };

interface RowDraft {
  use_standard: boolean;
  fixed_price: string;
  hourly_rate: string;
  default_hours: string;
  notes: string;
  preset_overrides: Record<string, ItemOverrideDraft>;
  addon_overrides: Record<string, ItemOverrideDraft>;
}

function defaultDraft(): RowDraft {
  return {
    use_standard: true,
    fixed_price: "",
    hourly_rate: "",
    default_hours: "",
    notes: "",
    preset_overrides: {},
    addon_overrides: {},
  };
}

function itemDraftFromMap(
  map: CatalogPresetOverridesMap | CatalogAddonOverridesMap | null | undefined,
  id: string,
): ItemOverrideDraft {
  const o = map?.[id];
  return {
    fixed_price: o?.fixed_price != null ? String(o.fixed_price) : "",
    partner_cost: o?.partner_cost != null ? String(o.partner_cost) : "",
  };
}

function draftFromServiceAndOverride(service: CatalogService, override: AccountServicePrice | null): RowDraft {
  const preset_overrides: Record<string, ItemOverrideDraft> = {};
  for (const p of sortPricingPresetsDisplay(parsePricingPresets(service.pricing_presets))) {
    preset_overrides[p.id] = itemDraftFromMap(override?.preset_overrides, p.id);
  }
  const addon_overrides: Record<string, ItemOverrideDraft> = {};
  for (const a of sortPricingAddonsDisplay(parsePricingAddons(service.pricing_addons))) {
    addon_overrides[a.id] = itemDraftFromMap(override?.addon_overrides, a.id);
  }
  return {
    use_standard: override ? override.use_standard : true,
    fixed_price: override?.fixed_price?.toString() ?? "",
    hourly_rate: override?.hourly_rate?.toString() ?? "",
    default_hours: override?.default_hours?.toString() ?? "",
    notes: override?.notes ?? "",
    preset_overrides,
    addon_overrides,
  };
}

function serializeItemOverrides(
  drafts: Record<string, ItemOverrideDraft>,
): CatalogPresetOverridesMap {
  const out: CatalogPresetOverridesMap = {};
  for (const [id, d] of Object.entries(drafts)) {
    const fixed_price = parseNumOrNull(d.fixed_price);
    const partner_cost = parseNumOrNull(d.partner_cost);
    if (fixed_price == null && partner_cost == null) continue;
    out[id] = {};
    if (fixed_price != null) out[id].fixed_price = fixed_price;
    if (partner_cost != null) out[id].partner_cost = partner_cost;
  }
  return out;
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
  const stackable = catalogHasStackableAddons(service);
  const presets = sortPricingPresetsDisplay(parsePricingPresets(service.pricing_presets));
  const addons = sortPricingAddonsDisplay(parsePricingAddons(service.pricing_addons));
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
            <Badge variant={isHourly ? "info" : "default"} size="sm" className="max-w-[13rem] whitespace-normal text-center leading-tight">
              {pricingModeLabel(isHourly ? "hourly" : "fixed")}
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

      {isCustom && stackable ? (
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-[10px] font-semibold uppercase text-text-tertiary mb-1.5">Base options</p>
            <div className="rounded-lg border border-border-light overflow-hidden text-xs">
              <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] gap-2 bg-surface-hover/50 px-2 py-1.5 font-medium text-text-tertiary">
                <span>Option</span>
                <span>Client £</span>
                <span>Partner £</span>
              </div>
              {presets.map((p) => {
                const mode = presetPricingMode(p);
                const catClient =
                  mode === "fixed" ? Number(p.fixed_price) || 0 : (Number(p.hourly_rate) || 0) * (p.default_hours ?? 1);
                const catPartner = Number(p.partner_cost) || 0;
                const d = draft.preset_overrides[p.id] ?? { fixed_price: "", partner_cost: "" };
                return (
                  <div key={p.id} className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] gap-2 px-2 py-2 border-t border-border-light items-center">
                    <div>
                      <p className="font-medium text-text-primary">{p.label}</p>
                      <p className="text-[10px] text-text-tertiary">
                        Catalog {formatCurrency(catClient)} · partner {formatCurrency(catPartner)}
                      </p>
                    </div>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={d.fixed_price}
                      onChange={(e) =>
                        onDraftChange({
                          preset_overrides: {
                            ...draft.preset_overrides,
                            [p.id]: { ...d, fixed_price: e.target.value },
                          },
                        })
                      }
                      onBlur={onCommit}
                      placeholder={String(catClient)}
                      className="h-8 text-xs"
                    />
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
                      placeholder={String(catPartner)}
                      className="h-8 text-xs"
                    />
                  </div>
                );
              })}
            </div>
          </div>
          {addons.length > 0 ? (
            <div>
              <p className="text-[10px] font-semibold uppercase text-text-tertiary mb-1.5">Additionals</p>
              <div className="rounded-lg border border-border-light overflow-hidden text-xs">
                <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] gap-2 bg-surface-hover/50 px-2 py-1.5 font-medium text-text-tertiary">
                  <span>Additional</span>
                  <span>Client £</span>
                  <span>Partner £</span>
                </div>
                {addons.map((a) => {
                  const d = draft.addon_overrides[a.id] ?? { fixed_price: "", partner_cost: "" };
                  return (
                    <div key={a.id} className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] gap-2 px-2 py-2 border-t border-border-light items-center">
                      <div>
                        <p className="font-medium text-text-primary">{a.label}</p>
                        <p className="text-[10px] text-text-tertiary">
                          Catalog {formatCurrency(a.fixed_price)} · partner {formatCurrency(Number(a.partner_cost) || 0)}
                        </p>
                      </div>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        value={d.fixed_price}
                        onChange={(e) =>
                          onDraftChange({
                            addon_overrides: {
                              ...draft.addon_overrides,
                              [a.id]: { ...d, fixed_price: e.target.value },
                            },
                          })
                        }
                        onBlur={onCommit}
                        placeholder={String(a.fixed_price)}
                        className="h-8 text-xs"
                      />
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
                        placeholder={String(a.partner_cost ?? 0)}
                        className="h-8 text-xs"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div>
            <label className="block text-[10px] font-semibold text-text-tertiary uppercase mb-1">Notes (optional)</label>
            <Input
              value={draft.notes}
              onChange={(e) => onDraftChange({ notes: e.target.value })}
              onBlur={onCommit}
              placeholder="e.g. agreed in May 2026"
            />
          </div>
        </div>
      ) : isCustom ? (
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
