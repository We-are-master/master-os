"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ChevronRight,
  LayoutGrid,
  List,
  Loader2,
  Pencil,
  Plus,
  Share2,
} from "lucide-react";
import { CatalogShareModal } from "@/components/catalog/catalog-share-modal";
import { PageTransition } from "@/components/layout/page-transition";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/input";
import { KpiCard, Pill } from "@/components/fx/primitives";
import { useAdminConfig } from "@/hooks/use-admin-config";
import { useSupabaseList } from "@/hooks/use-supabase-list";
import { listCatalogServices } from "@/services/catalog-services";
import { formatCurrency, cn } from "@/lib/utils";
import {
  buildAllServicePricingViews,
  computeServicesPricingKpis,
  filterServicePricingViews,
  tierPctClass,
  type MarginTier,
  type PricingLineRow,
  type ServicePricingView,
  type ServicesStatusFilter,
} from "@/lib/services-pricing-display";
import { entryForSlug } from "@/lib/service-display-icons";
import { useServiceCatalogEditor } from "@/app/(dashboard)/settings/service-catalog-editor";
import type { CatalogService } from "@/types/database";
import "./services-pricing.css";

type ViewMode = "list" | "cards";

function fmtPct(pct: number): string {
  return `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}%`;
}

function MarginBar({
  pay,
  charge,
  tier,
  small,
  title,
}: {
  pay: number;
  charge: number;
  tier: MarginTier;
  small?: boolean;
  title?: string;
}) {
  const costW = charge > 0 ? (pay / charge) * 100 : 0;
  const marginW = 100 - costW;
  const marginPct = charge > 0 ? marginW : 0;
  const thinClass = tier === "thin" ? "is-thin" : tier === "bad" ? "is-bad" : "";
  const minLabel = small ? 24 : 20;
  return (
    <div
      className={cn("pt-bar", small && "pt-bar--sm")}
      title={title ?? `Pay ${formatCurrency(pay)} · Keep ${formatCurrency(charge - pay)}`}
    >
      <span className="c" style={{ width: `${costW}%` }}>
        {costW >= minLabel ? fmtPct(costW) : null}
      </span>
      <span className={cn("m", thinClass)} style={{ width: `${marginW}%` }}>
        {marginW >= minLabel ? fmtPct(marginPct) : null}
      </span>
    </div>
  );
}

function ProminentLine({ line }: { line: PricingLineRow }) {
  const m = line.charge - line.pay;
  const costW = line.charge > 0 ? (line.pay / line.charge) * 100 : 0;
  const marginW = 100 - costW;
  return (
    <div className="pline">
      <div className="pline__top">
        <div>
          <div className="pline__name">{line.label}</div>
          <div className="pline__sub">{line.sub}</div>
        </div>
        <div className="pline__charge">
          <span className="k">You charge</span>
          <b>
            {formatCurrency(line.charge)}
            {line.unit ? <span className="unit">{line.unit}</span> : null}
          </b>
        </div>
      </div>
      <div
        className="pbar"
        title={`Pay ${formatCurrency(line.pay)} · Keep ${formatCurrency(m)} · Charge ${formatCurrency(line.charge)}`}
      >
        <div className="pbar__seg pbar__cost" style={{ flexBasis: `${costW}%` }}>
          <span className="k">You pay</span>
          <span className="v">{formatCurrency(line.pay)}</span>
        </div>
        <div className={cn("pbar__seg pbar__margin", `is-${line.tier}`)} style={{ flexBasis: `${marginW}%` }}>
          <span className="k">You keep</span>
          <span className="v">{formatCurrency(m)}</span>
        </div>
      </div>
      <div className="pline__foot">
        <span className={cn("mchip", `is-${line.tier}`)}>
          <span className="mchip__dot" />
          {fmtPct(line.marginPct)} margin
        </span>
        {line.note ? (
          <span className="keep">{line.note}</span>
        ) : (
          <span className="keep">
            Keep <b>{formatCurrency(m)}</b> per job
          </span>
        )}
      </div>
    </div>
  );
}

function AddonRow({ line }: { line: PricingLineRow }) {
  const costW = line.charge > 0 ? (line.pay / line.charge) * 100 : 0;
  return (
    <div className="ao">
      <div className="ao__name" title={line.label}>
        {line.label}
      </div>
      <div className="ao__pay">{formatCurrency(line.pay)}</div>
      <div className="ao__charge">{formatCurrency(line.charge)}</div>
      <div className="ao__m">
        <span className="ao__minibar">
          <i className="c" style={{ width: `${costW}%` }} />
          <i className={cn("m", line.tier !== "good" && `is-${line.tier}`)} style={{ width: `${100 - costW}%` }} />
        </span>
        <span className={cn("ao__pct", `is-${line.tier}`)}>{Math.round(line.marginPct)}%</span>
      </div>
    </div>
  );
}

function ServiceCard({
  view,
  onEdit,
}: {
  view: ServicePricingView;
  onEdit: (row: CatalogService) => void;
}) {
  const Icon = entryForSlug(view.slug).Icon;
  const head = view.headline;

  return (
    <article className={cn("svc", view.missing && "is-missing")} data-id={view.id}>
      <div className="svc__head">
        <div className="svc__icon">
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="svc__name">{view.name}</div>
          <div className="svc__metarow">
            <span className="svc__model">{view.model}</span>
            {view.missing ? (
              <span className="fx-pill fx-pill--warn">
                <span className="fx-pill__dot" />
                No price
              </span>
            ) : (
              <span className="fx-pill fx-pill--ok">
                <span className="fx-pill__dot" />
                {view.isActive ? "Active" : "Inactive"}
              </span>
            )}
          </div>
        </div>
        {head && !view.missing ? (
          <div className="svc__head-r">
            <span className="from">{view.single ? "Sell" : "From"}</span>
            <div className="amt">
              {formatCurrency(head.charge)}
              {head.unit ? <span className="unit">{head.unit}</span> : null}
            </div>
            <span className={cn("mchip", `is-${marginTierFromHead(head)}`)} style={{ marginTop: 6 }}>
              <span className="mchip__dot" />
              {fmtPct(marginPctFromHead(head))}
            </span>
          </div>
        ) : view.missing ? (
          <Button size="sm" onClick={() => onEdit(view.service)}>
            Set price
          </Button>
        ) : null}
        <button
          type="button"
          className="fx-seg__btn svc__edit"
          onClick={() => onEdit(view.service)}
          title="Edit pricing"
          aria-label="Edit pricing"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="svc__body">
        {view.missing ? (
          <div className="notset">
            <div className="notset__txt">
              <b>No price set yet</b>
              This service can&apos;t be quoted until you add a price.
            </div>
            <Button size="sm" variant="outline" onClick={() => onEdit(view.service)}>
              Add price
            </Button>
          </div>
        ) : view.single ? (
          <ProminentLine line={view.single} />
        ) : (
          <>
            {view.base.length > 0 ? (
              <>
                <div className="svc__seclbl">
                  <span>Base price · pick one</span>
                  <span>
                    {view.base.length} option{view.base.length === 1 ? "" : "s"}
                  </span>
                </div>
                {view.base.map((line) => (
                  <ProminentLine key={line.id} line={line} />
                ))}
              </>
            ) : null}
            {view.addons.length > 0 ? (
              <>
                <div className="svc__seclbl">
                  <span>Add-ons · stack on top</span>
                  <span>
                    {view.addons.length} item{view.addons.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="aogrid">
                  <div className="ao ao--head">
                    <span>Add-on</span>
                    <span className="r">Pay</span>
                    <span className="r">Charge</span>
                    <span className="r">Margin</span>
                  </div>
                  {view.addons.map((a) => (
                    <AddonRow key={a.id} line={a} />
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    </article>
  );
}

function marginPctFromHead(head: { pay: number; charge: number }): number {
  return head.charge > 0 ? ((head.charge - head.pay) / head.charge) * 100 : 0;
}

function marginTierFromHead(head: { pay: number; charge: number }): MarginTier {
  const pct = marginPctFromHead(head);
  if (pct >= 40) return "good";
  if (pct >= 30) return "thin";
  return "bad";
}

function ServiceListRows({
  views,
  expandedIds,
  onToggle,
  onEdit,
}: {
  views: ServicePricingView[];
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onEdit: (row: CatalogService) => void;
}) {
  return (
    <>
      {views.map((view) => {
        const Icon = entryForSlug(view.slug).Icon;
        const canExpand = view.addons.length > 0;
        const isOpen = expandedIds.has(view.id);

        if (view.missing) {
          return (
            <tr key={view.id} className="lr is-missing">
              <td>
                <div className="lr__name">
                  <span className="lr__chev" style={{ visibility: "hidden" }} />
                  <span className="lr__icon">
                    <Icon className="h-[15px] w-[15px]" aria-hidden />
                  </span>
                  <div>
                    <div className="fx-tbl__primary">{view.name}</div>
                    <div className="fx-tbl__sub">no price set</div>
                  </div>
                </div>
              </td>
              <td>
                <span className="fx-pill fx-pill--ghost">{view.model}</span>
              </td>
              <td className="fx-tbl__num is-mute">—</td>
              <td className="fx-tbl__num is-mute">—</td>
              <td>
                <Pill tone="warn" dot>
                  Set price
                </Pill>
              </td>
              <td className="fx-tbl__num is-mute">—</td>
              <td>
                <Button size="sm" onClick={() => onEdit(view.service)}>
                  Add
                </Button>
              </td>
            </tr>
          );
        }

        const head = view.headline!;
        const m = head.charge - head.pay;
        const pct = marginPctFromHead(head);
        const tier = marginTierFromHead(head);

        return (
          <ServiceListRowGroup
            key={view.id}
            view={view}
            Icon={Icon}
            canExpand={canExpand}
            isOpen={isOpen}
            head={head}
            m={m}
            pct={pct}
            tier={tier}
            onToggle={onToggle}
            onEdit={onEdit}
          />
        );
      })}
    </>
  );
}

function ServiceListRowGroup({
  view,
  Icon,
  canExpand,
  isOpen,
  head,
  m,
  pct,
  tier,
  onToggle,
  onEdit,
}: {
  view: ServicePricingView;
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  canExpand: boolean;
  isOpen: boolean;
  head: { pay: number; charge: number; unit?: string };
  m: number;
  pct: number;
  tier: MarginTier;
  onToggle: (id: string) => void;
  onEdit: (row: CatalogService) => void;
}) {
  return (
    <>
      <tr
        className={cn("lr", canExpand && "is-expandable", isOpen && "is-open")}
        onClick={() => canExpand && onToggle(view.id)}
      >
        <td>
          <div className="lr__name">
            <span className="lr__chev">
              {canExpand ? <ChevronRight className="h-3.5 w-3.5" /> : null}
            </span>
            <span className="lr__icon">
              <Icon className="h-[15px] w-[15px]" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="fx-tbl__primary">{view.name}</div>
              <div className="fx-tbl__sub">{view.subline}</div>
            </div>
          </div>
        </td>
        <td>
          <span className="fx-pill fx-pill--ghost">{view.model}</span>
        </td>
        <td className="fx-tbl__num">{formatCurrency(head.pay)}</td>
        <td className="fx-tbl__num">
          {formatCurrency(head.charge)}
          {head.unit ? <span className="is-mute">{head.unit}</span> : null}
        </td>
        <td>
          <MarginBar pay={head.pay} charge={head.charge} tier={tier} title={`Keep ${formatCurrency(m)}`} />
        </td>
        <td className={cn("fx-tbl__num", tierPctClass(tier))}>{fmtPct(pct)}</td>
        <td>
          <button
            type="button"
            className="fx-seg__btn"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(view.service);
            }}
            title="Edit pricing"
            aria-label="Edit pricing"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </td>
      </tr>
      {view.addons.map((addon) => (
        <tr key={`${view.id}-${addon.id}`} className="lr-sub" hidden={!isOpen}>
          <td>
            <div className="lr__subname">＋ {addon.label}</div>
          </td>
          <td>
            <span className="lr__addtag">Add-on</span>
          </td>
          <td className="fx-tbl__num">{formatCurrency(addon.pay)}</td>
          <td className="fx-tbl__num">{formatCurrency(addon.charge)}</td>
          <td>
            <MarginBar
              pay={addon.pay}
              charge={addon.charge}
              tier={addon.tier}
              small
              title={`Keep ${formatCurrency(addon.charge - addon.pay)}`}
            />
          </td>
          <td className={cn("fx-tbl__num", tierPctClass(addon.tier))}>{fmtPct(addon.marginPct)}</td>
          <td />
        </tr>
      ))}
    </>
  );
}

function ViewSegment({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  return (
    <div className="fx-seg">
      <button
        type="button"
        className={cn("fx-seg__btn", view === "list" && "is-active")}
        onClick={() => onChange("list")}
      >
        <List className="h-3.5 w-3.5" />
        List
      </button>
      <button
        type="button"
        className={cn("fx-seg__btn", view === "cards" && "is-active")}
        onClick={() => onChange("cards")}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        Cards
      </button>
    </div>
  );
}

function StatusSegment({
  status,
  onChange,
}: {
  status: ServicesStatusFilter;
  onChange: (s: ServicesStatusFilter) => void;
}) {
  const tabs: { id: ServicesStatusFilter; label: string }[] = [
    { id: "active", label: "Active" },
    { id: "all", label: "All" },
    { id: "thin", label: "Thin margin" },
  ];
  return (
    <div className="fx-seg">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={cn("fx-seg__btn", status === t.id && "is-active")}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function ServicesPricingClient() {
  const { can, loading: configLoading } = useAdminConfig();
  const canCatalog = can("service_catalog");

  const { data, loading, refresh } = useSupabaseList<CatalogService>({
    fetcher: listCatalogServices,
    realtimeTable: "service_catalog",
    pageSize: 500,
  });

  const editor = useServiceCatalogEditor({ onSaved: refresh });
  const [shareOpen, setShareOpen] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState<ServicesStatusFilter>("active");
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const allViews = useMemo(() => buildAllServicePricingViews(data), [data]);
  const kpis = useMemo(() => computeServicesPricingKpis(allViews), [allViews]);
  const filtered = useMemo(
    () => filterServicePricingViews(allViews, statusFilter, search),
    [allViews, statusFilter, search],
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (configLoading) {
    return (
      <PageTransition>
        <div className="flex items-center justify-center py-24 text-text-tertiary">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        </div>
      </PageTransition>
    );
  }

  if (!canCatalog) {
    return (
      <PageTransition>
        <div className="rounded-xl border border-border-light bg-card p-8 text-center">
          <p className="text-sm text-text-secondary">You don&apos;t have access to the service catalog.</p>
        </div>
      </PageTransition>
    );
  }

  const missingHint =
    kpis.missingPriceNames.length > 0
      ? `${kpis.missingPriceNames[0]}${kpis.missingPriceNames.length > 1 ? ` +${kpis.missingPriceNames.length - 1}` : ""} · needs a price`
      : "all priced";

  return (
    <PageTransition>
      <div className="svc-pricing space-y-6">
        <PageHeader
          eyebrow="Catalog · Pricing"
          title="Services"
          subtitle="What you pay, what you charge, and what you keep — for every service. Click a row to expand add-ons; click edit to change pricing."
        >
          <ViewSegment view={viewMode} onChange={setViewMode} />
          <Button
            size="sm"
            variant="secondary"
            icon={<Share2 className="h-3.5 w-3.5" />}
            onClick={() => setShareOpen(true)}
          >
            Share rate card
          </Button>
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={editor.openCreate}>
            New service
          </Button>
        </PageHeader>

        <CatalogShareModal open={shareOpen} onClose={() => setShareOpen(false)} />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Active services"
            value={kpis.activeCount}
            sub={`${kpis.inactiveCount} inactive · ${kpis.totalCount} total`}
          />
          <KpiCard
            label="Average margin"
            value={
              <span className="text-fx-green">{kpis.avgMarginPct.toFixed(1)}%</span>
            }
            sub="across all sell prices"
          />
          <KpiCard
            label="Thin margin · review"
            variant="alert"
            value={kpis.thinMarginLineCount}
            sub="lines under 40%"
          />
          <KpiCard
            label="No price set"
            variant="coral"
            value={kpis.missingPriceCount}
            sub={missingHint}
          />
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="legend">
            <span className="legend__t">How to read</span>
            <div className="legend__demo">
              <span className="c" />
              <span className="m" />
            </div>
            <div className="legend__i">
              <span className="legend__sw bg-fx-navy" />
              <span className="legend__lbl">
                <b>You pay</b> the partner
              </span>
            </div>
            <span className="legend__arrow">→</span>
            <div className="legend__i">
              <span className="legend__sw bg-fx-green" />
              <span className="legend__lbl">
                <b>You keep</b> the margin
              </span>
            </div>
            <span className="legend__arrow">=</span>
            <div className="legend__i">
              <span className="legend__lbl">
                <b>You charge</b> the client
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <StatusSegment status={statusFilter} onChange={setStatusFilter} />
            <SearchInput
              placeholder="Search services…"
              className="w-full sm:w-56"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-text-tertiary">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          </div>
        ) : viewMode === "list" ? (
          <div className="overflow-x-auto rounded-xl border border-fx-line bg-card">
            <table className="fx-tbl" id="listTbl">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Pricing model</th>
                  <th className="fx-tbl__num">You pay</th>
                  <th className="fx-tbl__num">You charge</th>
                  <th>Margin · pay vs keep</th>
                  <th className="fx-tbl__num">%</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-sm text-text-tertiary">
                      No services match this filter.
                    </td>
                  </tr>
                ) : (
                  <ServiceListRows
                    views={filtered}
                    expandedIds={expandedIds}
                    onToggle={toggleExpanded}
                    onEdit={editor.openEdit}
                  />
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="svc-grid">
            {filtered.length === 0 ? (
              <p className="col-span-full py-12 text-center text-sm text-text-tertiary">
                No services match this filter.
              </p>
            ) : (
              filtered.map((view) => (
                <ServiceCard key={view.id} view={view} onEdit={editor.openEdit} />
              ))
            )}
          </div>
        )}

        {editor.modals}
      </div>
    </PageTransition>
  );
}
