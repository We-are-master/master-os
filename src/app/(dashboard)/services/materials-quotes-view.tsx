"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { SearchInput } from "@/components/ui/input";
import { KpiCard, Pill } from "@/components/fx/primitives";
import {
  listSupplierPrices,
  quoteFromSuppliers,
  type MaterialQuote,
} from "@/services/pricing";
import { formatCurrency, cn } from "@/lib/utils";

/**
 * Materiais com a regra do dono (17/08/2026): vender pela MÉDIA do mercado,
 * comprar do mais barato, nunca abaixo de custo × 1.30 — margem à vista.
 *
 * Cada preço carrega o link do produto de onde saiu ("já deixar link de onde
 * você quoted"): a linha mostra o melhor fornecedor, e expandir abre o
 * comparativo completo. Fatos vêm de supplier_prices; a conta é a mesma da
 * view material_quotes do banco.
 */

const FAMILY_LABELS: Record<string, string> = {
  internal_door: "Internal doors",
  door_hinge: "Hinges",
  door_latch: "Latches",
  door_handle: "Handles",
  tv_bracket: "TV brackets",
  blind: "Blinds",
  curtain_pole: "Curtain poles",
  shelf_bracket: "Shelf brackets",
  mdf: "MDF",
  screws: "Screws",
  fixings: "Fixings",
  paint: "Paint",
  paint_sundries: "Painting sundries",
  sealant: "Sealants",
  filler: "Fillers",
  plumbing: "Plumbing",
  electrical: "Electrical",
  tiling: "Tiling",
  garden: "Garden",
};

const SUPPLIER_LABELS: Record<string, string> = {
  screwfix: "Screwfix",
  toolstation: "Toolstation",
  wickes: "Wickes",
  bandq: "B&Q",
  travisperkins: "Travis Perkins",
};

function marginTone(pct: number): "ok" | "warn" {
  return pct >= 40 ? "ok" : "warn";
}

function QuoteRow({ quote }: { quote: MaterialQuote }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <td className="font-medium">
          <span className="inline-flex items-center gap-1.5">
            <ChevronRight
              className={cn("h-3.5 w-3.5 text-text-tertiary transition-transform", open && "rotate-90")}
              aria-hidden
            />
            {quote.variant}
          </span>
        </td>
        <td className="whitespace-nowrap">
          <a
            href={quote.melhor.source_url ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-fx-green hover:underline"
            title={quote.melhor.sample_product ?? undefined}
            onClick={(e) => e.stopPropagation()}
          >
            {SUPPLIER_LABELS[quote.melhor.supplier] ?? quote.melhor.supplier} · {formatCurrency(quote.custo)}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </td>
        <td className="fx-tbl__num whitespace-nowrap text-text-secondary">{formatCurrency(quote.media)}</td>
        <td className="fx-tbl__num whitespace-nowrap font-semibold">{formatCurrency(quote.nossoPreco)}</td>
        <td className="fx-tbl__num whitespace-nowrap">
          <Pill tone={marginTone(quote.margemPct)} dot={false}>
            {Math.round(quote.margemPct)}%
          </Pill>
        </td>
        <td className="fx-tbl__num text-text-tertiary">{quote.fontes.length}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="bg-bg-secondary/40 px-4 py-3">
            <div className="space-y-1.5">
              {quote.fontes.map((f) => {
                const packMath = typeof f.spec?.pack_math === "string" ? f.spec.pack_math : null;
                return (
                  <div key={f.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
                    <span className={cn("w-28 font-medium", f.id === quote.melhor.id && "text-fx-green")}>
                      {SUPPLIER_LABELS[f.supplier] ?? f.supplier}
                    </span>
                    <span className="font-semibold">{formatCurrency(f.unit_cost)}</span>
                    {packMath && <span className="text-text-tertiary">{packMath}</span>}
                    {f.source_url ? (
                      <a
                        href={f.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate text-text-secondary hover:text-text-primary hover:underline"
                        title={f.sample_product ?? undefined}
                      >
                        {f.sample_product ?? f.source_url}
                      </a>
                    ) : (
                      <span className="truncate text-text-tertiary">{f.sample_product}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function MaterialsQuotesView() {
  const [quotes, setQuotes] = useState<MaterialQuote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    listSupplierPrices()
      .then((rows) => setQuotes(quoteFromSuppliers(rows)))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const grouped = useMemo(() => {
    if (!quotes) return [];
    const q = search.trim().toLowerCase();
    const visible = q
      ? quotes.filter((x) =>
          `${x.family} ${x.variant} ${x.fontes.map((f) => f.sample_product).join(" ")}`
            .toLowerCase()
            .includes(q),
        )
      : quotes;
    const byFamily = new Map<string, MaterialQuote[]>();
    for (const x of visible) {
      const list = byFamily.get(x.family);
      if (list) list.push(x);
      else byFamily.set(x.family, [x]);
    }
    return [...byFamily.entries()];
  }, [quotes, search]);

  const kpis = useMemo(() => {
    const all = quotes ?? [];
    const precos = all.reduce((a, x) => a + x.fontes.length, 0);
    const margemMedia = all.length ? all.reduce((a, x) => a + x.margemPct, 0) / all.length : 0;
    const noPiso = all.filter((x) => Math.abs(x.nossoPreco - (Math.floor(x.custo * 1.3) + 0.99)) < 0.02).length;
    return { variantes: all.length, precos, margemMedia, noPiso };
  }, [quotes]);

  if (error) {
    return (
      <div className="rounded-xl border border-fx-line bg-card p-8 text-center text-sm text-text-secondary">
        Could not load supplier prices: {error}
        <br />
        If the table does not exist yet, apply migration 253_supplier_prices.sql first.
      </div>
    );
  }
  if (!quotes) {
    return (
      <div className="flex items-center justify-center py-20 text-text-tertiary">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Material variants" value={kpis.variantes} sub={`${kpis.precos} prices with product links`} />
        <KpiCard
          label="Average margin"
          value={<span className="text-fx-green">{Math.round(kpis.margemMedia)}%</span>}
          sub="sell at market average, buy from the cheapest"
        />
        <KpiCard label="On the 30% floor" value={kpis.noPiso} sub="market average was below cost × 1.30" />
        <KpiCard label="Suppliers" value={5} sub="Screwfix · Toolstation · Wickes · B&Q · Travis Perkins" />
      </div>

      <div className="flex justify-end">
        <SearchInput
          placeholder="Search materials…"
          className="w-full sm:w-64"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {grouped.map(([family, familyQuotes]) => (
        <div key={family} className="space-y-2">
          <h3 className="text-sm font-semibold text-text-primary">
            {FAMILY_LABELS[family] ?? family}
            <span className="ml-2 font-normal text-text-tertiary">{familyQuotes.length}</span>
          </h3>
          <div className="overflow-x-auto rounded-xl border border-fx-line bg-card">
            <table className="fx-tbl">
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>Buy from (cheapest)</th>
                  <th className="fx-tbl__num">Market avg</th>
                  <th className="fx-tbl__num">Our price</th>
                  <th className="fx-tbl__num">Margin</th>
                  <th className="fx-tbl__num">Sources</th>
                </tr>
              </thead>
              <tbody>
                {familyQuotes.map((quote) => (
                  <QuoteRow key={`${quote.family}-${quote.variant}`} quote={quote} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
