"use client";

import { useState, useEffect } from "react";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabase } from "@/services/base";
import { formatCurrency } from "@/lib/utils";
import type {
  WidgetConfig, CustomMetricOptions, CustomChartOptions, CustomTableOptions,
  CustomTable,
} from "@/types/dashboard-config";
import {
  COLOUR_MAP,
  TABLE_META,
  resolveJobsNumericField,
  isJobsCurrencyField,
} from "@/types/dashboard-config";
import * as LucideIcons from "lucide-react";
import { AlertCircle } from "lucide-react";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatValue(value: number, prefix?: string, suffix?: string): string {
  if (prefix === "£" || prefix === "$" || prefix === "€") return formatCurrency(value);
  const formatted = value % 1 === 0 ? value.toLocaleString() : value.toFixed(2);
  return `${prefix ?? ""}${formatted}${suffix ?? ""}`;
}

function getIcon(name: string): React.ElementType {
  const icons = LucideIcons as unknown as Record<string, React.ElementType>;
  return icons[name] ?? LucideIcons.Hash;
}

function customChartValueIsCurrency(opts: CustomChartOptions): boolean {
  if (opts.aggregation === "count") return false;
  const vf = opts.value_field;
  if (vf === "amount" || vf === "total_amount" || vf === "net_payout" || vf === "gross_amount") return true;
  if (vf === "revenue" || vf === "cost") return true;
  if (opts.table === "jobs" && isJobsCurrencyField(vf)) return true;
  return false;
}

// ─── Custom Metric ─────────────────────────────────────────────────────────

export function CustomMetricWidget({ widget }: { widget: WidgetConfig }) {
  const opts = widget.options as CustomMetricOptions | undefined;
  const [value, setValue] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opts) return;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const supabase = getSupabase();
        const selectField =
          opts!.aggregation === "count"
            ? "id"
            : opts!.table === "jobs"
              ? resolveJobsNumericField(opts!.field ?? "id")
              : (opts!.field ?? "id");
        let query = supabase.from(opts!.table as CustomTable).select(selectField);
        if (opts!.filter_field && opts!.filter_value) {
          query = query.eq(opts!.filter_field, opts!.filter_value);
        }
        const { data, error: err } = await query;
        if (err) throw new Error(err.message);
        const rows = ((data ?? []) as unknown) as Record<string, unknown>[];
        let result = 0;
        if (opts!.aggregation === "count") {
          result = rows.length;
        } else if (opts!.aggregation === "sum") {
          result = rows.reduce((s: number, r: Record<string, unknown>) => s + Number(r[selectField] ?? 0), 0);
        } else {
          result = rows.length > 0
            ? rows.reduce((s: number, r: Record<string, unknown>) => s + Number(r[selectField] ?? 0), 0) / rows.length
            : 0;
          result = Math.round(result * 100) / 100;
        }
        setValue(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [opts?.table, opts?.aggregation, opts?.field, opts?.filter_field, opts?.filter_value]);

  const colour = COLOUR_MAP[opts?.colour ?? "blue"];
  const IconComp = getIcon(opts?.icon ?? "Hash");
  const tableMeta = opts ? TABLE_META[opts.table] : null;

  return (
    <Card padding="none" className="h-full">
      <div className="p-5 flex items-start gap-4">
        <div className={`h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0 ${colour.bg} ${colour.text}`}>
          <IconComp className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide truncate">{widget.title}</p>
          {loading ? (
            <div className="h-8 w-24 mt-1 animate-pulse bg-surface-tertiary rounded" />
          ) : error ? (
            <div className="flex items-center gap-1 mt-1 text-red-500 text-xs"><AlertCircle className="h-3 w-3" />{error}</div>
          ) : (
            <p className={`text-3xl font-bold mt-1 ${colour.text}`}>
              {formatValue(value ?? 0, opts?.prefix, opts?.suffix)}
            </p>
          )}
          <p className="text-[11px] text-text-tertiary mt-0.5">
            {opts?.caption ?? (tableMeta ? `From ${tableMeta.label}${opts?.filter_field ? ` · ${opts.filter_field}=${opts.filter_value}` : ""}` : "")}
          </p>
        </div>
      </div>
    </Card>
  );
}

// ─── Custom Chart ──────────────────────────────────────────────────────────

export function CustomChartWidget({ widget }: { widget: WidgetConfig }) {
  const opts = widget.options as CustomChartOptions | undefined;
  const [data, setData] = useState<{ label: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opts) return;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const supabase = getSupabase();
        const months = opts!.period_months ?? 12;
        const now = new Date();
        const startDate = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1).toISOString();

        const valueField =
          opts!.aggregation === "count"
            ? ""
            : opts!.table === "jobs"
              ? resolveJobsNumericField(opts!.value_field)
              : opts!.value_field;
        const fields =
          opts!.aggregation === "count"
            ? `${opts!.date_field}`
            : `${opts!.date_field},${valueField}`;

        let query = supabase.from(opts!.table).select(fields).gte(opts!.date_field, startDate);
        if (opts!.filter_field && opts!.filter_value) {
          query = query.eq(opts!.filter_field, opts!.filter_value);
        }
        const { data, error: err } = await query;
        if (err) throw new Error(err.message);
        const rows = ((data ?? []) as unknown) as Record<string, unknown>[];

        const monthData: { label: string; value: number }[] = [];
        for (let i = months - 1; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          const label = MONTH_LABELS[d.getMonth()];
          const monthRows = rows.filter((r) =>
            String(r[opts!.date_field] ?? "").startsWith(key)
          );
          const value = opts!.aggregation === "count"
            ? monthRows.length
            : monthRows.reduce((s: number, r: Record<string, unknown>) => s + Number(r[valueField] ?? 0), 0);
          monthData.push({ label, value });
        }
        setData(monthData);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [opts?.table, opts?.date_field, opts?.value_field, opts?.aggregation, opts?.period_months, opts?.filter_field, opts?.filter_value]);

  const colour = COLOUR_MAP[opts?.colour ?? "blue"];
  const chartType = opts?.chart_type ?? "bar";

  const ChartComponent = chartType === "line" ? LineChart : chartType === "area" ? AreaChart : BarChart;

  return (
    <Card padding="none" className="h-full">
      <CardHeader className="px-5 pt-5">
        <div>
          <CardTitle>{widget.title}</CardTitle>
          <p className="text-xs text-text-tertiary mt-0.5">
            {opts ? `${TABLE_META[opts.table]?.label} · last ${opts.period_months}m` : ""}
          </p>
        </div>
      </CardHeader>
      <div className="px-3 pb-5">
        {loading ? (
          <div className="h-44 animate-pulse bg-surface-hover rounded-xl" />
        ) : error ? (
          <div className="flex items-center justify-center h-44 gap-2 text-red-500 text-sm">
            <AlertCircle className="h-4 w-4" />{error}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={176}>
            <ChartComponent data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id={`cg_${widget.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={colour.fill} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={colour.fill} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip
                formatter={(v) => [
                  formatValue(
                    Number(v ?? 0),
                    opts?.aggregation === "count"
                      ? undefined
                      : customChartValueIsCurrency(opts!)
                        ? "£"
                        : undefined
                  ),
                  widget.title,
                ]}
                contentStyle={{ borderRadius: 10, fontSize: 12, border: "1px solid #e5e7eb" }}
              />
              {chartType === "bar" && (
                <Bar dataKey="value" fill={colour.fill} radius={[4, 4, 0, 0]} />
              )}
              {chartType === "line" && (
                <Line type="monotone" dataKey="value" stroke={colour.fill} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
              )}
              {chartType === "area" && (
                <Area type="monotone" dataKey="value" stroke={colour.fill} strokeWidth={2} fill={`url(#cg_${widget.id})`} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
              )}
            </ChartComponent>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

// ─── Custom Table ──────────────────────────────────────────────────────────

type RowData = Record<string, unknown>;

function formatCell(value: unknown, field: string, table?: CustomTable): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" && value.match(/^\d{4}-\d{2}-\d{2}/)) {
    return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }
  const resolved = table === "jobs" ? resolveJobsNumericField(field) : field;
  const num = typeof value === "number" ? value : Number(value);
  const isMoney =
    field === "revenue" ||
    field === "cost" ||
    field === "amount" ||
    field === "total_amount" ||
    field === "net_payout" ||
    field === "gross_amount" ||
    (table === "jobs" && isJobsCurrencyField(resolved));
  if (isMoney && !Number.isNaN(num)) {
    return formatCurrency(num);
  }
  return String(value);
}

export function CustomTableWidget({ widget }: { widget: WidgetConfig }) {
  const opts = widget.options as CustomTableOptions | undefined;
  const [rows, setRows] = useState<RowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opts) return;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const supabase = getSupabase();
        const selectFields = [
          ...new Set(
            opts!.columns.map((c) =>
              opts!.table === "jobs" ? resolveJobsNumericField(c.field) : c.field
            )
          ),
        ].join(",");
        let query = supabase
          .from(opts!.table)
          .select(selectFields)
          .order(opts!.sort_field, { ascending: opts!.sort_dir === "asc" })
          .limit(opts!.limit ?? 10);
        if (opts!.filter_field && opts!.filter_value) {
          query = query.eq(opts!.filter_field, opts!.filter_value);
        }
        const { data, error: err } = await query;
        if (err) throw new Error(err.message);
        let rows = ((data ?? []) as unknown) as RowData[];
        if (opts!.table === "jobs") {
          rows = rows.map((r) => {
            const row = { ...r };
            for (const c of opts!.columns) {
              if (c.field === "revenue" && row.client_price !== undefined && row.client_price !== null) {
                (row as Record<string, unknown>).revenue = row.client_price;
              }
              if (c.field === "cost" && row.partner_cost !== undefined && row.partner_cost !== null) {
                (row as Record<string, unknown>).cost = row.partner_cost;
              }
            }
            return row;
          });
        }
        setRows(rows);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [opts?.table, opts?.columns, opts?.sort_field, opts?.sort_dir, opts?.limit, opts?.filter_field, opts?.filter_value]);

  const columns = opts?.columns ?? [];

  return (
    <Card padding="none" className="h-full">
      <CardHeader className="px-5 pt-5">
        <div>
          <CardTitle>{widget.title}</CardTitle>
          <p className="text-xs text-text-tertiary mt-0.5">
            {opts ? `${TABLE_META[opts.table]?.label} · last ${opts.limit} records` : ""}
          </p>
        </div>
      </CardHeader>
      <div className="overflow-x-auto pb-5">
        {loading ? (
          <div className="px-5 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-9 animate-pulse bg-surface-hover rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-8 gap-2 text-red-500 text-sm px-5">
            <AlertCircle className="h-4 w-4" />{error}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-text-tertiary">No records found</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-light">
                {columns.map((col) => (
                  <th key={col.field} className="px-5 py-2 text-left font-semibold text-text-tertiary uppercase tracking-wide whitespace-nowrap">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-border-light/50 hover:bg-surface-hover/50 transition-colors">
                  {columns.map((col) => (
                    <td key={col.field} className="px-5 py-2.5 text-text-primary whitespace-nowrap">
                      {col.field === "status" ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-surface-tertiary text-text-secondary">
                          {String(row[col.field] ?? "—").replace(/_/g, " ")}
                        </span>
                      ) : (
                        formatCell(row[col.field], col.field, opts?.table)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}
