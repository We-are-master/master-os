"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
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
  Loader2,
  ChevronRight,
} from "lucide-react";
import type { AuditLog } from "@/types/database";
import { buildAuditTitle, buildAuditDescription } from "@/lib/audit-display";

/** Max card height ~ Sales Pipeline widget (header + ~6 compact rows). */
const CARD_MAX_HEIGHT = "max-h-[360px]";

const PREVIEW_FETCH = 6;
const PREVIEW_SHOW = 5;

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
  quote: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300",
  job: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300",
  partner: "bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-300",
  invoice: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300",
  account: "bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-300",
  self_bill: "bg-surface-tertiary text-text-secondary",
  system: "bg-surface-tertiary text-text-secondary",
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
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = getSupabase();
      try {
        const { data } = await supabase
          .from("audit_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(PREVIEW_FETCH);
        const rows = (data ?? []) as AuditLog[];
        setHasMore(rows.length > PREVIEW_SHOW);
        setLogs(rows.slice(0, PREVIEW_SHOW));
      } catch {
        // non-critical
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <Card
      padding="none"
      className={`flex flex-col ${CARD_MAX_HEIGHT} overflow-hidden h-full`}
    >
      <CardHeader className="px-5 pt-4 pb-3 mb-0 shrink-0 border-b border-border-light">
        <CardTitle>Recent Activity</CardTitle>
        <Link
          href="/activity"
          className="text-xs font-medium text-primary hover:text-primary-hover hover:underline transition-colors"
        >
          View all
        </Link>
      </CardHeader>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center py-10 shrink-0">
            <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
          </div>
        )}

        {!loading && logs.length === 0 && (
          <div className="px-3 py-6 text-center shrink-0">
            <AlertTriangle className="h-6 w-6 text-stone-300 mx-auto mb-2" />
            <p className="text-sm text-text-tertiary">No recent activity</p>
            <p className="text-xs text-text-tertiary mt-1">Activity will appear here as you use the system</p>
          </div>
        )}

        {!loading && logs.length > 0 && (
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              className="px-2 py-1 space-y-0.5"
            >
              {logs.map((log) => {
                const Icon = entityIcons[log.entity_type] ?? AlertTriangle;
                const badge = getActionBadge(log.action);
                const title = buildAuditTitle(log);
                const desc = buildAuditDescription(log);
                return (
                  <motion.div
                    key={log.id}
                    variants={staggerItem}
                    whileHover={{ backgroundColor: "rgba(0,0,0,0.015)" }}
                    className="flex items-start gap-2.5 px-2 py-2 rounded-lg transition-colors"
                  >
                    <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${entityColors[log.entity_type] ?? "bg-surface-tertiary text-text-secondary"}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <p className="text-xs font-medium text-text-primary line-clamp-2">
                          {title}
                        </p>
                        <Badge variant={badge.variant} size="sm" className="text-[10px] shrink-0">
                          {badge.label}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-text-tertiary line-clamp-1">
                        {desc}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1">
                        {log.user_name && <Avatar name={log.user_name} size="xs" />}
                        <span className="text-[10px] text-text-tertiary">
                          {log.user_name ?? "System"} · {formatRelativeTime(log.created_at)}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        )}

        {!loading && hasMore && (
          <div className="shrink-0 border-t border-border-light px-4 py-2.5 bg-surface-secondary/30">
            <Link
              href="/activity"
              className="flex items-center justify-center gap-1 text-xs font-semibold text-primary hover:text-primary-hover transition-colors"
            >
              See more
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </div>
    </Card>
  );
}
