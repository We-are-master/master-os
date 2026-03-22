"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { modalTransition, overlayTransition } from "@/lib/motion";
import { X, Hash, BarChart2, Table2, Check, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  WidgetConfig, WidgetType, WidgetSize,
  CustomMetricOptions, CustomChartOptions, CustomTableOptions,
  CustomTable, CustomAggregation, CustomChartType, CustomColour,
  CustomTableColumn,
} from "@/types/dashboard-config";
import { TABLE_META, COLOUR_MAP } from "@/types/dashboard-config";

const uuidv4 = () => crypto.randomUUID();

// ─── Options ──────────────────────────────────────────────────────────────────

const TABLES = Object.entries(TABLE_META).map(([key, meta]) => ({ value: key as CustomTable, label: meta.label }));
const AGGREGATIONS: { value: CustomAggregation; label: string }[] = [
  { value: "count", label: "Count (number of rows)" },
  { value: "sum",   label: "Sum (total of a field)" },
  { value: "avg",   label: "Average (mean of a field)" },
];
const CHART_TYPES: { value: CustomChartType; label: string }[] = [
  { value: "bar",  label: "Bar chart" },
  { value: "line", label: "Line chart" },
  { value: "area", label: "Area chart" },
];
const COLOURS: { value: CustomColour; label: string }[] = [
  { value: "emerald", label: "Green"  },
  { value: "blue",    label: "Blue"   },
  { value: "amber",   label: "Amber"  },
  { value: "red",     label: "Red"    },
  { value: "purple",  label: "Purple" },
  { value: "indigo",  label: "Indigo" },
  { value: "rose",    label: "Rose"   },
  { value: "orange",  label: "Orange" },
];
const PERIODS: { value: 3 | 6 | 12; label: string }[] = [
  { value: 3,  label: "Last 3 months" },
  { value: 6,  label: "Last 6 months" },
  { value: 12, label: "Last 12 months" },
];
const LIMITS: { value: 5 | 10 | 20; label: string }[] = [
  { value: 5,  label: "5 rows"  },
  { value: 10, label: "10 rows" },
  { value: 20, label: "20 rows" },
];
const ICONS = ["Hash", "DollarSign", "Briefcase", "FileText", "Users", "TrendingUp", "TrendingDown", "Percent", "BarChart2", "Activity", "Clock", "CheckCircle2", "AlertTriangle", "Star"];

type CustomType = "custom_metric" | "custom_chart" | "custom_table";

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (widget: WidgetConfig) => void;
}

// ─── Shared field selector ────────────────────────────────────────────────────

function FieldSelect({ table, value, onChange, label, includeCount = false }: {
  table: CustomTable; value: string; onChange: (v: string) => void; label: string; includeCount?: boolean;
}) {
  const meta = TABLE_META[table];
  return (
    <div>
      <label className="block text-xs font-semibold text-text-secondary mb-1.5">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm text-text-primary">
        {includeCount && <option value="count">Count (rows)</option>}
        {meta.numericFields.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
    </div>
  );
}

function FilterRow({ table, filterField, filterValue, onFieldChange, onValueChange }: {
  table: CustomTable; filterField: string; filterValue: string;
  onFieldChange: (v: string) => void; onValueChange: (v: string) => void;
}) {
  const meta = TABLE_META[table];
  const allFields = [...meta.textFields, ...meta.numericFields];
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label className="block text-xs font-semibold text-text-secondary mb-1.5">Filter field (optional)</label>
        <select value={filterField} onChange={(e) => onFieldChange(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm text-text-primary">
          <option value="">— none —</option>
          {allFields.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-semibold text-text-secondary mb-1.5">Filter value</label>
        <Input value={filterValue} onChange={(e) => onValueChange(e.target.value)} placeholder="e.g. completed" disabled={!filterField} />
      </div>
    </div>
  );
}

// ─── Metric builder ───────────────────────────────────────────────────────────

function MetricBuilder({ onAdd, onClose }: { onAdd: (w: WidgetConfig) => void; onClose: () => void }) {
  const [title, setTitle] = useState("Custom Metric");
  const [size, setSize] = useState<WidgetSize>("one_third");
  const [opts, setOpts] = useState<CustomMetricOptions>({
    table: "jobs", aggregation: "count", colour: "blue", icon: "Hash",
  });

  const set = <K extends keyof CustomMetricOptions>(k: K, v: CustomMetricOptions[K]) =>
    setOpts((p) => ({ ...p, [k]: v }));

  const meta = TABLE_META[opts.table];
  const needsField = opts.aggregation !== "count";

  const handleAdd = () => {
    if (needsField && !opts.field) { alert("Please select a field for sum/average."); return; }
    onAdd({
      id: uuidv4(), type: "custom_metric", title, size, position: 0,
      options: opts as unknown as Record<string, unknown>,
    });
    onClose();
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-tertiary">
        Display a single number — count, sum or average — from any table, with an optional filter.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Widget title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Total Revenue" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Size</label>
          <select value={size} onChange={(e) => setSize(e.target.value as WidgetSize)} className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm text-text-primary">
            <option value="one_third">1/3 column</option>
            <option value="half">Half</option>
            <option value="two_thirds">2/3</option>
            <option value="full">Full width</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Data source</label>
          <select value={opts.table} onChange={(e) => set("table", e.target.value as CustomTable)} className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm text-text-primary">
            {TABLES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Aggregation</label>
          <select value={opts.aggregation} onChange={(e) => set("aggregation", e.target.value as CustomAggregation)} className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm text-text-primary">
            {AGGREGATIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>
      </div>

      {needsField && meta.numericFields.length > 0 && (
        <FieldSelect table={opts.table} value={opts.field ?? meta.numericFields[0]} onChange={(v) => set("field", v)} label="Field to aggregate" />
      )}

      <FilterRow
        table={opts.table}
        filterField={opts.filter_field ?? ""}
        filterValue={opts.filter_value ?? ""}
        onFieldChange={(v) => set("filter_field", v || undefined)}
        onValueChange={(v) => set("filter_value", v || undefined)}
      />

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Colour</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {COLOURS.map((c) => {
              const cm = COLOUR_MAP[c.value];
              return (
                <button key={c.value} title={c.label} onClick={() => set("colour", c.value)}
                  className={`h-6 w-6 rounded-full border-2 transition-transform ${opts.colour === c.value ? "border-text-primary scale-110" : "border-transparent"}`}
                  style={{ backgroundColor: cm.fill }}
                />
              );
            })}
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Icon</label>
          <select value={opts.icon} onChange={(e) => set("icon", e.target.value)} className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm text-text-primary">
            {ICONS.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Caption</label>
          <Input value={opts.caption ?? ""} onChange={(e) => set("caption", e.target.value || undefined)} placeholder="e.g. This month" />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-border-light">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={handleAdd}>Add to view</Button>
      </div>
    </div>
  );
}

// ─── Chart builder ────────────────────────────────────────────────────────────

function ChartBuilder({ onAdd, onClose }: { onAdd: (w: WidgetConfig) => void; onClose: () => void }) {
  const [title, setTitle] = useState("Custom Chart");
  const [size, setSize] = useState<WidgetSize>("two_thirds");
  const [opts, setOpts] = useState<CustomChartOptions>({
    table: "jobs", date_field: "created_at", value_field: "client_price",
    aggregation: "sum", chart_type: "bar", period_months: 6, colour: "blue",
  });

  const set = <K extends keyof CustomChartOptions>(k: K, v: CustomChartOptions[K]) =>
    setOpts((p) => ({ ...p, [k]: v }));

  const meta = TABLE_META[opts.table];

  const handleAdd = () => {
    onAdd({
      id: uuidv4(), type: "custom_chart", title, size, position: 0,
      options: opts as unknown as Record<string, unknown>,
    });
    onClose();
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-tertiary">
        Plot any numeric field from any table grouped by month as a bar, line or area chart.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Widget title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Monthly Revenue" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Size</label>
          <select value={size} onChange={(e) => setSize(e.target.value as WidgetSize)} className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm text-text-primary">
            <option value="one_third">1/3 column</option>
            <option value="half">Half</option>
            <option value="two_thirds">2/3</option>
            <option value="full">Full width</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Data source</label>
          <select value={opts.table} onChange={(e) => {
            const t = e.target.value as CustomTable;
            set("table", t);
            set("date_field", TABLE_META[t].dateFields[0] ?? "created_at");
            set("value_field", TABLE_META[t].numericFields[0] ?? "count");
          }} className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm text-text-primary">
            {TABLES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Date field (X axis)</label>
          <select value={opts.date_field} onChange={(e) => set("date_field", e.target.value)} className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm text-text-primary">
            {meta.dateFields.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Value (Y axis)</label>
          <select value={opts.value_field} onChange={(e) => set("value_field", e.target.value)} className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm text-text-primary">
            <option value="count">Count (number of rows)</option>
            {meta.numericFields.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Aggregation</label>
          <select value={opts.aggregation} onChange={(e) => set("aggregation", e.target.value as CustomAggregation)} className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm text-text-primary">
            {AGGREGATIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Chart type</label>
          <div className="flex gap-2">
            {CHART_TYPES.map((ct) => (
              <button key={ct.value} onClick={() => set("chart_type", ct.value)}
                className={`flex-1 py-1.5 rounded-xl text-xs font-medium border transition-all ${opts.chart_type === ct.value ? "bg-primary text-white border-primary" : "bg-card border-border text-text-secondary hover:bg-surface-hover"}`}>
                {ct.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Period</label>
          <select value={opts.period_months} onChange={(e) => set("period_months", Number(e.target.value) as 3 | 6 | 12)} className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm text-text-primary">
            {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </div>

      <FilterRow
        table={opts.table}
        filterField={opts.filter_field ?? ""}
        filterValue={opts.filter_value ?? ""}
        onFieldChange={(v) => set("filter_field", v || undefined)}
        onValueChange={(v) => set("filter_value", v || undefined)}
      />

      <div>
        <label className="block text-xs font-semibold text-text-secondary mb-1.5">Colour</label>
        <div className="flex flex-wrap gap-1.5">
          {COLOURS.map((c) => {
            const cm = COLOUR_MAP[c.value];
            return (
              <button key={c.value} title={c.label} onClick={() => set("colour", c.value)}
                className={`h-6 w-6 rounded-full border-2 transition-transform ${opts.colour === c.value ? "border-text-primary scale-110" : "border-transparent"}`}
                style={{ backgroundColor: cm.fill }}
              />
            );
          })}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-border-light">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={handleAdd}>Add to view</Button>
      </div>
    </div>
  );
}

// ─── Table builder ────────────────────────────────────────────────────────────

function TableBuilder({ onAdd, onClose }: { onAdd: (w: WidgetConfig) => void; onClose: () => void }) {
  const [title, setTitle] = useState("Custom Table");
  const [size, setSize] = useState<WidgetSize>("full");
  const [table, setTable] = useState<CustomTable>("jobs");
  const [columns, setColumns] = useState<CustomTableColumn[]>([
    { field: "reference", label: "Reference" },
    { field: "title", label: "Title" },
    { field: "status", label: "Status" },
    { field: "created_at", label: "Created" },
  ]);
  const [limit, setLimit] = useState<5 | 10 | 20>(10);
  const [sortField, setSortField] = useState("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterField, setFilterField] = useState("");
  const [filterValue, setFilterValue] = useState("");

  const meta = TABLE_META[table];
  const allFields = [...meta.textFields, ...meta.numericFields, ...meta.dateFields];

  const addColumn = () => setColumns((p) => [...p, { field: allFields[0], label: allFields[0] }]);
  const removeColumn = (i: number) => setColumns((p) => p.filter((_, idx) => idx !== i));
  const updateColumn = (i: number, k: "field" | "label", v: string) =>
    setColumns((p) => p.map((c, idx) => idx === i ? { ...c, [k]: v } : c));

  const handleAdd = () => {
    if (columns.length === 0) { alert("Add at least one column."); return; }
    const opts: CustomTableOptions = {
      table, columns, limit, sort_field: sortField, sort_dir: sortDir,
      filter_field: filterField || undefined,
      filter_value: filterValue || undefined,
    };
    onAdd({
      id: uuidv4(), type: "custom_table", title, size, position: 0,
      options: opts as unknown as Record<string, unknown>,
    });
    onClose();
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-tertiary">
        Display a live table of records from any data source with configurable columns, sorting and filters.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Widget title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Recent Jobs" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Size</label>
          <select value={size} onChange={(e) => setSize(e.target.value as WidgetSize)} className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm text-text-primary">
            <option value="half">Half</option>
            <option value="two_thirds">2/3</option>
            <option value="full">Full width</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Data source</label>
          <select value={table} onChange={(e) => { setTable(e.target.value as CustomTable); setColumns([]); }} className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm text-text-primary">
            {TABLES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Row limit</label>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value) as 5 | 10 | 20)} className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm text-text-primary">
            {LIMITS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
      </div>

      {/* Columns */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs font-semibold text-text-secondary">Columns</label>
          <button onClick={addColumn} className="text-xs font-medium text-primary hover:text-primary-hover flex items-center gap-1">
            <Plus className="h-3 w-3" /> Add column
          </button>
        </div>
        <div className="space-y-1.5">
          {columns.map((col, i) => (
            <div key={i} className="flex gap-2 items-center">
              <select value={col.field} onChange={(e) => updateColumn(i, "field", e.target.value)}
                className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-card text-xs text-text-primary">
                {allFields.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <Input value={col.label} onChange={(e) => updateColumn(i, "label", e.target.value)} placeholder="Label" className="flex-1 text-xs py-1.5" />
              <button onClick={() => removeColumn(i)} className="p-1 rounded hover:bg-red-50 text-red-400">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Sort by</label>
          <select value={sortField} onChange={(e) => setSortField(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm text-text-primary">
            {allFields.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">Sort direction</label>
          <div className="flex gap-2">
            {(["asc", "desc"] as const).map((d) => (
              <button key={d} onClick={() => setSortDir(d)}
                className={`flex-1 py-1.5 rounded-xl text-xs font-medium border transition-all ${sortDir === d ? "bg-primary text-white border-primary" : "bg-card border-border text-text-secondary hover:bg-surface-hover"}`}>
                {d === "asc" ? "Ascending" : "Descending"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <FilterRow
        table={table}
        filterField={filterField}
        filterValue={filterValue}
        onFieldChange={setFilterField}
        onValueChange={setFilterValue}
      />

      <div className="flex justify-end gap-2 pt-2 border-t border-border-light">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={handleAdd}>Add to view</Button>
      </div>
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

const CUSTOM_TYPES: { type: CustomType; label: string; description: string; icon: React.ElementType }[] = [
  { type: "custom_metric", label: "Custom Metric",  description: "A single number — count, sum or average",            icon: Hash },
  { type: "custom_chart",  label: "Custom Chart",   description: "Bar, line or area chart grouped by month",           icon: BarChart2 },
  { type: "custom_table",  label: "Custom Table",   description: "A live table with configurable columns & filters",   icon: Table2 },
];

export function CustomWidgetBuilder({ open, onClose, onAdd }: Props) {
  const [step, setStep] = useState<"pick" | "configure">("pick");
  const [selectedType, setSelectedType] = useState<CustomType | null>(null);

  const handleClose = () => { setStep("pick"); setSelectedType(null); onClose(); };
  const handleAdd = (w: WidgetConfig) => { setStep("pick"); setSelectedType(null); onAdd(w); };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <motion.div variants={overlayTransition} initial="hidden" animate="visible" exit="hidden"
            className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />
          <motion.div variants={modalTransition} initial="hidden" animate="visible" exit="hidden"
            className="relative z-10 w-full max-w-xl bg-card rounded-2xl shadow-2xl border border-card-border flex flex-col max-h-[90vh]">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-light">
              <div>
                <h2 className="text-base font-bold text-text-primary">
                  {step === "pick" ? "Create Custom Widget" : `Custom ${selectedType?.replace("custom_", "").replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}`}
                </h2>
                <p className="text-xs text-text-tertiary mt-0.5">
                  {step === "pick" ? "Choose the type of widget to create" : "Configure the widget and add it to your view"}
                </p>
              </div>
              <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors">
                <X className="h-4 w-4 text-text-tertiary" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {step === "pick" ? (
                <div className="space-y-3">
                  {CUSTOM_TYPES.map(({ type, label, description, icon: IconComp }) => (
                    <button key={type} onClick={() => { setSelectedType(type); setStep("configure"); }}
                      className="w-full text-left p-4 rounded-2xl border border-border bg-card hover:bg-surface-hover hover:border-primary/30 transition-all group flex items-start gap-3">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                        <IconComp className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-text-primary group-hover:text-primary transition-colors">{label}</p>
                        <p className="text-xs text-text-tertiary mt-0.5">{description}</p>
                      </div>
                      <Check className="h-4 w-4 text-primary ml-auto mt-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  {selectedType === "custom_metric" && <MetricBuilder onAdd={handleAdd} onClose={handleClose} />}
                  {selectedType === "custom_chart"  && <ChartBuilder  onAdd={handleAdd} onClose={handleClose} />}
                  {selectedType === "custom_table"  && <TableBuilder  onAdd={handleAdd} onClose={handleClose} />}
                </>
              )}
            </div>

            {step === "configure" && (
              <div className="px-6 py-3 border-t border-border-light">
                <button onClick={() => setStep("pick")} className="text-xs text-text-tertiary hover:text-primary transition-colors">
                  ← Back to widget type
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
