"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
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
  ArrowLeft,
} from "lucide-react";
import type { AuditLog } from "@/types/database";
import { buildAuditTitle, buildAuditDescription } from "@/lib/audit-display";

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

const PAGE_SIZE = 80;

export default function ActivityLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getSupabase();
      try {
        const { data, error } = await supabase
          .from("audit_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(PAGE_SIZE);
        if (!cancelled && !error && data) setLogs(data as AuditLog[]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PageTransition>
      <div className="space-y-5">
        <PageHeader title="Activity log" subtitle={`Last ${PAGE_SIZE} events from audit trail`}>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-primary transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
        </PageHeader>

        <Card padding="md" className="overflow-hidden">
          {loading && (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-text-tertiary" />
            </div>
          )}

          {!loading && logs.length === 0 && (
            <p className="text-sm text-text-tertiary text-center py-12">No activity recorded yet.</p>
          )}

          {!loading && logs.length > 0 && (
            <ul className="divide-y divide-border-light -mx-2">
              {logs.map((log) => {
                const Icon = entityIcons[log.entity_type] ?? AlertTriangle;
                const badge = getActionBadge(log.action);
                return (
                  <li key={log.id} className="flex gap-3 px-2 py-3 hover:bg-surface-hover/60 rounded-lg transition-colors">
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${entityColors[log.entity_type] ?? "bg-surface-tertiary text-text-secondary"}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-text-primary">{buildAuditTitle(log)}</p>
                        <Badge variant={badge.variant} size="sm">{badge.label}</Badge>
                      </div>
                      <p className="text-xs text-text-tertiary mt-0.5">{buildAuditDescription(log)}</p>
                      <div className="flex items-center gap-2 mt-2">
                        {log.user_name && <Avatar name={log.user_name} size="xs" />}
                        <span className="text-[11px] text-text-tertiary">
                          {log.user_name ?? "System"} · {formatRelativeTime(log.created_at)}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </PageTransition>
  );
}
