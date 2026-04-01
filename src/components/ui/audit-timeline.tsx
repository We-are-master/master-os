"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { staggerItem } from "@/lib/motion";
import {
  Plus, Edit3, ArrowRightLeft, ChevronUp, User, FileText,
  CreditCard, Users, Clock, AlertCircle, Layers,
} from "lucide-react";
import type { AuditLog, AuditEntityType } from "@/types/database";
import { getAuditLogs } from "@/services/audit";

const actionConfig: Record<string, { icon: typeof Plus; color: string; label: string }> = {
  created: { icon: Plus, color: "bg-emerald-100 text-emerald-600", label: "Created" },
  updated: { icon: Edit3, color: "bg-blue-100 text-blue-600", label: "Updated" },
  status_changed: { icon: ArrowRightLeft, color: "bg-amber-100 text-amber-600", label: "Status Changed" },
  phase_advanced: { icon: ChevronUp, color: "bg-purple-100 text-purple-600", label: "Phase Advanced" },
  assigned: { icon: User, color: "bg-indigo-100 text-indigo-600", label: "Assigned" },
  deleted: { icon: AlertCircle, color: "bg-red-100 text-red-600", label: "Deleted" },
  note: { icon: FileText, color: "bg-surface-tertiary text-text-secondary", label: "Note Added" },
  document_added: { icon: FileText, color: "bg-teal-100 text-teal-600", label: "Document Added" },
  payment: { icon: CreditCard, color: "bg-emerald-100 text-emerald-600", label: "Payment" },
  bulk_update: { icon: Users, color: "bg-orange-100 text-orange-600", label: "Bulk Update" },
};

const fieldLabels: Record<string, string> = {
  status: "Status",
  progress: "Progress",
  current_phase: "Phase",
  total_phases: "Total Phases",
  client_price: "Client Price",
  partner_cost: "Partner Cost",
  materials_cost: "Materials Cost",
  partner_name: "Partner",
  owner_name: "Owner",
  title: "Title",
  client_name: "Client",
  property_address: "Property Address",
  priority: "Priority",
  scheduled_date: "Scheduled Date",
  due_date: "Due Date",
  paid_date: "Paid Date",
  amount: "Amount",
  total_value: "Total Value",
  trade: "Trade",
  verified: "Verified",
  compliance_score: "Compliance",
  rating: "Rating",
  description: "Description",
  service_type: "Service Type",
  estimated_value: "Estimated Value",
  ai_confidence: "AI Confidence",
  stripe_payment_status: "Stripe Status",
  margin_percent: "Margin %",
  quote_figures: "Quote figures",
  timer_manager_adjustment: "Work timer (manager)",
};

function formatFieldName(field: string): string {
  return fieldLabels[field] || field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(value: string | undefined | null): string {
  if (!value || value === "null" || value === "undefined") return "—";
  if (value === "true") return "Yes";
  if (value === "false") return "No";
  const num = Number(value);
  if (!isNaN(num) && value.includes(".")) return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface AuditTimelineProps {
  entityType: AuditEntityType;
  entityId: string;
  className?: string;
  /** When true, audit logs are fetched only after the block enters the viewport (lighter initial page load). */
  deferUntilVisible?: boolean;
}

export function AuditTimeline({
  entityType,
  entityId,
  className = "",
  deferUntilVisible = false,
}: AuditTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(!deferUntilVisible);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(!deferUntilVisible);

  useEffect(() => {
    setShouldLoad(!deferUntilVisible);
    setLogs([]);
    setLoading(!deferUntilVisible);
  }, [entityId, entityType, deferUntilVisible]);

  useEffect(() => {
    if (!deferUntilVisible) return;
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setShouldLoad(true);
      },
      { rootMargin: "160px", threshold: 0.01 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [deferUntilVisible, entityId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAuditLogs(entityType, entityId);
      setLogs(data);
    } catch { /* non-critical */ }
    finally { setLoading(false); }
  }, [entityType, entityId]);

  useEffect(() => {
    if (!shouldLoad) return;
    load();
  }, [shouldLoad, load]);

  if (!shouldLoad) {
    return (
      <div
        ref={containerRef}
        className={`py-10 px-4 text-center rounded-xl border border-dashed border-border bg-surface-hover/50 ${className}`}
      >
        <Clock className="h-6 w-6 text-text-tertiary/80 mx-auto mb-2" />
        <p className="text-xs text-text-tertiary">Activity history loads when you scroll to this section</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`space-y-4 ${className}`}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="animate-pulse h-8 w-8 bg-surface-tertiary rounded-lg shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="animate-pulse h-3 w-32 bg-surface-tertiary rounded" />
              <div className="animate-pulse h-2.5 w-48 bg-surface-hover rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div ref={containerRef} className={`py-12 text-center ${className}`}>
        <Clock className="h-8 w-8 text-stone-300 mx-auto mb-2" />
        <p className="text-sm text-text-tertiary">No activity recorded yet</p>
        <p className="text-xs text-text-tertiary mt-1">Changes will appear here as they happen</p>
      </div>
    );
  }

  const grouped = groupByDate(logs);

  return (
    <div ref={containerRef} className={`space-y-5 ${className}`}>
      {grouped.map(([dateLabel, items]) => (
        <div key={dateLabel}>
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider mb-3">{dateLabel}</p>
          <div className="space-y-0">
            {items.map((log, idx) => {
              const config = actionConfig[log.action] || actionConfig.updated;
              const Icon = config.icon;
              const isLast = idx === items.length - 1;

              return (
                <motion.div key={log.id} variants={staggerItem} className="flex gap-3">
                  {/* Timeline line + icon */}
                  <div className="flex flex-col items-center">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${config.color}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    {!isLast && <div className="w-0.5 flex-1 bg-surface-tertiary my-1" />}
                  </div>

                  {/* Content */}
                  <div className={`flex-1 min-w-0 ${isLast ? "" : "pb-4"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary">
                          {getLogTitle(log)}
                        </p>
                        <p className="text-xs text-text-tertiary mt-0.5">
                          {getLogDescription(log)}
                        </p>
                      </div>
                      <span className="text-[10px] text-text-tertiary whitespace-nowrap shrink-0">{timeAgo(log.created_at)}</span>
                    </div>

                    {/* Field change detail */}
                    {log.field_name && log.action !== "created" && (
                      <div className="mt-2 p-2 rounded-lg bg-surface-hover border border-border-light">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-text-tertiary font-medium">{formatFieldName(log.field_name)}</span>
                          {log.old_value && (
                            <>
                              <span className="text-red-400 line-through">{formatValue(log.old_value)}</span>
                              <Layers className="h-3 w-3 text-stone-300" />
                            </>
                          )}
                          <span className="text-emerald-600 font-semibold">{formatValue(log.new_value)}</span>
                        </div>
                      </div>
                    )}

                    {/* User attribution */}
                    {log.user_name && (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <div className="h-4 w-4 rounded-full bg-border flex items-center justify-center">
                          <User className="h-2.5 w-2.5 text-text-secondary" />
                        </div>
                        <span className="text-[10px] text-text-tertiary">{log.user_name}</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function getLogTitle(log: AuditLog): string {
  switch (log.action) {
    case "created": return `${log.entity_type.replace(/^\w/, (c) => c.toUpperCase())} created`;
    case "status_changed": return `Status changed to ${formatValue(log.new_value)}`;
    case "phase_advanced": return `Advanced to Phase ${log.new_value}`;
    case "assigned": return `Assigned to ${log.new_value}`;
    case "deleted": return `${log.entity_type.replace(/^\w/, (c) => c.toUpperCase())} deleted`;
    case "note": return "Note added";
    case "document_added": return "Document added";
    case "payment": return `Payment ${formatValue(log.new_value)}`;
    case "bulk_update": return `Bulk update — ${formatFieldName(log.field_name ?? "")}`;
    case "updated":
      if (log.field_name === "timer_manager_adjustment") return "Work timer adjusted (manager)";
      return `${formatFieldName(log.field_name ?? "Record")} updated`;
    default: return "Activity recorded";
  }
}

function getLogDescription(log: AuditLog): string {
  if (log.action === "created") return `${log.entity_ref ?? "Record"} was created`;
  if (log.action === "status_changed" && log.old_value) {
    return `Changed from ${formatValue(log.old_value)} to ${formatValue(log.new_value)}`;
  }
  if (log.action === "bulk_update") {
    const count = (log.metadata as Record<string, number>)?.bulk_count;
    return count ? `Part of a batch update of ${count} items` : "Bulk operation";
  }
  if (log.field_name === "timer_manager_adjustment") {
    const note = (log.metadata as Record<string, unknown>)?.note;
    const noteStr = typeof note === "string" && note.trim() ? ` Note: ${note.trim()}` : "";
    return `Elapsed time changed; client/partner totals recalculated.${noteStr}`;
  }
  if (log.field_name && log.old_value) {
    return `${formatFieldName(log.field_name)}: ${formatValue(log.old_value)} → ${formatValue(log.new_value)}`;
  }
  return log.entity_ref ?? "";
}

function groupByDate(logs: AuditLog[]): [string, AuditLog[]][] {
  const groups = new Map<string, AuditLog[]>();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  for (const log of logs) {
    const d = new Date(log.created_at).toDateString();
    const label = d === today ? "Today" : d === yesterday ? "Yesterday" : new Date(log.created_at).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    const arr = groups.get(label) ?? [];
    arr.push(log);
    groups.set(label, arr);
  }

  return Array.from(groups.entries());
}
