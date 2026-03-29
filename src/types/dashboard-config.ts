import type { RoleKey } from "@/types/admin-config";

export type WidgetSize = "one_third" | "half" | "two_thirds" | "full";

// ─── Custom widget option shapes ─────────────────────────────────────────────

export type CustomTable = "jobs" | "quotes" | "service_requests" | "invoices" | "self_bills" | "partners";
export type CustomAggregation = "count" | "sum" | "avg";
export type CustomChartType = "bar" | "line" | "area";
export type CustomColour = "emerald" | "blue" | "amber" | "red" | "purple" | "indigo" | "rose" | "orange";

export interface CustomMetricOptions {
  table: CustomTable;
  aggregation: CustomAggregation;
  /** required for sum/avg */
  field?: string;
  /** optional filter: WHERE filter_field = filter_value */
  filter_field?: string;
  filter_value?: string;
  colour: CustomColour;
  icon: string;
  prefix?: string;
  suffix?: string;
  /** secondary KPI label below the value */
  caption?: string;
}

export interface CustomChartOptions {
  table: CustomTable;
  /** date column used to group by month */
  date_field: string;
  /** numeric column to aggregate, or "count" */
  value_field: string;
  aggregation: CustomAggregation;
  chart_type: CustomChartType;
  period_months: 3 | 6 | 12;
  /** optional filter: WHERE filter_field = filter_value */
  filter_field?: string;
  filter_value?: string;
  colour: CustomColour;
}

export type CustomTableColumn = {
  field: string;
  label: string;
};

export interface CustomTableOptions {
  table: CustomTable;
  columns: CustomTableColumn[];
  limit: 5 | 10 | 20;
  sort_field: string;
  sort_dir: "asc" | "desc";
  /** optional filter */
  filter_field?: string;
  filter_value?: string;
}

// ─── Table/field metadata for the builder UI ─────────────────────────────────

export const TABLE_META: Record<CustomTable, { label: string; dateFields: string[]; numericFields: string[]; textFields: string[]; statusField?: string }> = {
  jobs: {
    label: "Jobs",
    dateFields:   ["created_at", "scheduled_start_at", "completed_date"],
    /** Real `jobs` columns (there is no `revenue` / `cost` in the schema). */
    numericFields: [
      "client_price",
      "partner_cost",
      "materials_cost",
      "margin_percent",
      "commission",
      "service_value",
      "partner_agreed_value",
      "cash_in",
      "cash_out",
      "expenses",
    ],
    textFields:   ["reference", "title", "status", "partner_name", "finance_status"],
    statusField:  "status",
  },
  quotes: {
    label: "Quotes",
    dateFields:   ["created_at", "updated_at"],
    numericFields:["total_amount"],
    textFields:   ["reference", "title", "status"],
    statusField:  "status",
  },
  service_requests: {
    label: "Service Requests",
    dateFields:   ["created_at", "updated_at"],
    numericFields:[],
    textFields:   ["reference", "title", "status", "source"],
    statusField:  "status",
  },
  invoices: {
    label: "Invoices",
    dateFields:   ["created_at", "paid_date"],
    numericFields:["amount"],
    textFields:   ["reference", "status"],
    statusField:  "status",
  },
  self_bills: {
    label: "Self-Bills",
    dateFields:   ["created_at", "updated_at"],
    numericFields:["net_payout", "gross_amount"],
    textFields:   ["reference", "status"],
    statusField:  "status",
  },
  partners: {
    label: "Partners",
    dateFields:   ["created_at"],
    numericFields:["commission_rate"],
    textFields:   ["company_name", "status", "trade"],
    statusField:  "status",
  },
};

/**
 * Legacy custom widgets used `revenue` / `cost`, which are not columns on `jobs`.
 * Map to real columns so saved dashboards keep working.
 */
export function resolveJobsNumericField(field: string): string {
  if (field === "revenue") return "client_price";
  /** Approximate “direct cost” for charts that summed a single legacy column */
  if (field === "cost") return "partner_cost";
  return field;
}

const JOB_CURRENCY_FIELDS = new Set([
  "client_price",
  "partner_cost",
  "materials_cost",
  "commission",
  "service_value",
  "partner_agreed_value",
  "cash_in",
  "cash_out",
  "expenses",
  "customer_deposit",
  "customer_final_payment",
  "partner_payment_1",
  "partner_payment_2",
  "partner_payment_3",
  "revenue",
  "cost",
]);

export function isJobsCurrencyField(field: string): boolean {
  return JOB_CURRENCY_FIELDS.has(field);
}

export const COLOUR_MAP: Record<CustomColour, { bg: string; text: string; fill: string }> = {
  emerald: { bg: "bg-emerald-50",  text: "text-emerald-600", fill: "#34d399" },
  blue:    { bg: "bg-blue-50",     text: "text-blue-600",    fill: "#60a5fa" },
  amber:   { bg: "bg-amber-50",    text: "text-amber-600",   fill: "#fbbf24" },
  red:     { bg: "bg-red-50",      text: "text-red-600",     fill: "#f87171" },
  purple:  { bg: "bg-purple-50",   text: "text-purple-600",  fill: "#a78bfa" },
  indigo:  { bg: "bg-indigo-50",   text: "text-indigo-600",  fill: "#818cf8" },
  rose:    { bg: "bg-rose-50",     text: "text-rose-600",    fill: "#fb7185" },
  orange:  { bg: "bg-orange-50",   text: "text-orange-600",  fill: "#f97316" },
};

// ─── Widget config ────────────────────────────────────────────────────────────

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  title: string;
  size: WidgetSize;
  position: number;
  /** type-specific options (required for custom_* types) */
  options?: Record<string, unknown>;
}

export type WidgetType =
  | "stats_grid"
  | "revenue_chart"
  | "quote_funnel"
  | "jobs_status_donut"
  | "margin_chart"
  | "partner_performance"
  | "finance_flow"
  | "financial_snapshot"
  | "pipeline_summary"
  | "priority_tasks"
  | "activity_feed"
  | "quick_actions"
  // ── custom ──
  | "custom_metric"
  | "custom_chart"
  | "custom_table";

export interface WidgetMeta {
  type: WidgetType;
  label: string;
  description: string;
  icon: string;
  defaultSize: WidgetSize;
  isCustom?: boolean;
}

export const WIDGET_CATALOG: WidgetMeta[] = [
  { type: "stats_grid",          label: "Overview executive",    description: "Revenue, margins, tier vs billing, top partner & accounts, cashflow", icon: "BarChart2", defaultSize: "full" },
  { type: "revenue_chart",       label: "Revenue Chart",         description: "Collected vs invoiced revenue per month",            icon: "TrendingUp",    defaultSize: "two_thirds" },
  { type: "quote_funnel",        label: "Quote → Job Funnel",    description: "End-to-end conversion: request → quote → job",      icon: "Filter",        defaultSize: "one_third" },
  { type: "jobs_status_donut",   label: "Jobs by Status",        description: "Donut chart of all jobs by current status",         icon: "PieChart",      defaultSize: "one_third" },
  { type: "margin_chart",        label: "Margin Trend",          description: "Margin percentage trend over time",                  icon: "Percent",       defaultSize: "one_third" },
  { type: "partner_performance", label: "Top Partners",          description: "Partner ranking by revenue and jobs",                icon: "Award",         defaultSize: "half" },
  { type: "finance_flow",        label: "Cash Flow",             description: "Collected vs partner payouts vs net",                icon: "DollarSign",    defaultSize: "half" },
  { type: "financial_snapshot",  label: "Financial Snapshot",    description: "Full financial position summary",                    icon: "Receipt",       defaultSize: "full" },
  { type: "pipeline_summary",    label: "Pipeline",              description: "Active pipeline stages",                             icon: "Layers",        defaultSize: "one_third" },
  { type: "priority_tasks",      label: "Priority Tasks",        description: "Jobs and quotes requiring attention",                icon: "AlertTriangle", defaultSize: "one_third" },
  { type: "activity_feed",       label: "Activity Feed",         description: "Recent events across the system",                   icon: "Activity",      defaultSize: "one_third" },
  { type: "quick_actions",       label: "Quick Actions",         description: "Shortcuts to create a request, quote or job",       icon: "Zap",           defaultSize: "one_third" },
];

export const CUSTOM_WIDGET_CATALOG: WidgetMeta[] = [
  { type: "custom_metric", label: "Custom Metric",     description: "Count, sum or average any field from any table, with optional filter.",        icon: "Hash",        defaultSize: "one_third", isCustom: true },
  { type: "custom_chart",  label: "Custom Chart",      description: "Bar, line or area chart from any table grouped by month.",                     icon: "BarChart2",   defaultSize: "two_thirds", isCustom: true },
  { type: "custom_table",  label: "Custom Table",      description: "Show a live list of records from any table with configurable columns & filters.", icon: "Table2",      defaultSize: "full",       isCustom: true },
];

export interface DashboardView {
  id: string;
  name: string;
  description?: string;
  icon: string;
  is_default: boolean;
  sort_order: number;
  permissions: RoleKey[];
  widgets: WidgetConfig[];
  created_at?: string;
  updated_at?: string;
}
