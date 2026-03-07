"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { getSupabase } from "@/services/base";
import { formatRelativeTime } from "@/lib/utils";
import {
  Inbox,
  FileText,
  Briefcase,
  Users,
  Receipt,
  AlertTriangle,
  CheckCircle2,
  Edit3,
  ArrowRightLeft,
  Loader2,
} from "lucide-react";
import type { AuditLog } from "@/types/database";

const entityIcons: Record<string, typeof Inbox> = {
  request: Inbox,
  quote: FileText,
  job: Briefcase,
  partner: Users,
  invoice: Receipt,
  account: Users,
  self_bill: Receipt,
  system: AlertTriangle,
};

const entityColors: Record<string, string> = {
  request: "bg-primary/10 text-primary",
  quote: "bg-blue-50 text-blue-600",
  job: "bg-emerald-50 text-emerald-600",
  partner: "bg-purple-50 text-purple-600",
  invoice: "bg-amber-50 text-amber-600",
  account: "bg-teal-50 text-teal-600",
  self_bill: "bg-stone-100 text-stone-600",
  system: "bg-stone-100 text-stone-600",
};

const actionLabels: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  status_changed: "Status Changed",
  phase_advanced: "Phase Advanced",
  assigned: "Assigned",
  deleted: "Deleted",
  note: "Note Added",
  document_added: "Document Added",
  payment: "Payment",
  bulk_update: "Bulk Update",
};

const entityLabels: Record<string, string> = {
  request: "Request",
  quote: "Quote",
  job: "Job",
  partner: "Partner",
  invoice: "Invoice",
  account: "Account",
  self_bill: "Self Bill",
  system: "System",
};

function buildTitle(log: AuditLog): string {
  const entity = entityLabels[log.entity_type] ?? log.entity_type;
  const ref = log.entity_ref ? ` ${log.entity_ref}` : "";

  switch (log.action) {
    case "created":
      return `New ${entity}${ref} created`;
    case "status_changed":
      return `${entity}${ref} → ${log.new_value ?? "updated"}`;
    case "phase_advanced":
      return `${entity}${ref} phase advanced`;
    case "assigned":
      return `${entity}${ref} assigned`;
    case "note":
      return `Note on ${entity}${ref}`;
    case "document_added":
      return `Document added to ${entity}${ref}`;
    case "payment":
      return `Payment on ${entity}${ref}`;
    case "bulk_update":
      return `Bulk update on ${entity}s`;
    default:
      return `${entity}${ref} ${log.action}`;
  }
}

function buildDescription(log: AuditLog): string {
  if (log.action === "status_changed" && log.field_name === "status") {
    return `${log.old_value ?? "—"} → ${log.new_value ?? "—"}`;
  }
  if (log.field_name && log.old_value && log.new_value) {
    return `${log.field_name}: ${log.old_value} → ${log.new_value}`;
  }
  if (log.action === "created") {
    return `${entityLabels[log.entity_type] ?? log.entity_type} record initialized`;
  }
  if (log.action === "bulk_update") {
    const count = (log.metadata as Record<string, unknown>)?.count;
    return count ? `${count} records updated` : "Multiple records updated";
  }
  return log.entity_ref ?? "";
}

function getActionBadge(action: string): { label: string; variant: "primary" | "success" | "info" | "warning" | "danger" | "default" } {
  switch (action) {
    case "created": return { label: "New", variant: "primary" };
    case "status_changed": return { label: "Status", variant: "info" };
    case "payment": return { label: "Payment", variant: "success" };
    case "deleted": return { label: "Deleted", variant: "danger" };
    case "bulk_update": return { label: "Bulk", variant: "warning" };
    default: return { label: actionLabels[action] ?? action, variant: "default" };
  }
}

export function ActivityFeed() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      try {
        const { data } = await supabase
          .from("audit_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(8);
        if (data) setLogs(data as AuditLog[]);
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <Card padding="none" className="h-full">
      <CardHeader className="px-5 pt-5">
        <CardTitle>Recent Activity</CardTitle>
        <button className="text-xs font-medium text-primary hover:text-primary-hover transition-colors">
          View all
        </button>
      </CardHeader>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-stone-400" />
        </div>
      )}

      {!loading && logs.length === 0 && (
        <div className="px-3 py-8 text-center">
          <AlertTriangle className="h-6 w-6 text-stone-300 mx-auto mb-2" />
          <p className="text-sm text-text-tertiary">No recent activity</p>
          <p className="text-xs text-text-tertiary mt-1">Activity will appear here as you use the system</p>
        </div>
      )}

      {!loading && logs.length > 0 && (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="px-2 pb-2 space-y-0.5"
        >
          {logs.map((log) => {
            const Icon = entityIcons[log.entity_type] ?? AlertTriangle;
            const badge = getActionBadge(log.action);
            const title = buildTitle(log);
            const desc = buildDescription(log);
            return (
              <motion.div
                key={log.id}
                variants={staggerItem}
                whileHover={{ backgroundColor: "rgba(0,0,0,0.015)" }}
                className="flex items-start gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors"
              >
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${entityColors[log.entity_type] ?? "bg-stone-100 text-stone-600"}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {title}
                    </p>
                    <Badge variant={badge.variant} size="sm">
                      {badge.label}
                    </Badge>
                  </div>
                  <p className="text-xs text-text-tertiary truncate">
                    {desc}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    {log.user_name && <Avatar name={log.user_name} size="xs" />}
                    <span className="text-[11px] text-text-tertiary">
                      {log.user_name ?? "System"} · {formatRelativeTime(log.created_at)}
                    </span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </Card>
  );
}
