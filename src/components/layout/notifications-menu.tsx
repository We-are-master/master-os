"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Loader2, Inbox, FileText, Briefcase, Users, Receipt, AlertTriangle } from "lucide-react";
import { getSupabase } from "@/services/base";
import { formatRelativeTime, cn } from "@/lib/utils";
import type { AuditLog } from "@/types/database";
import { buildAuditTitle, buildAuditDescription, auditLogHref } from "@/lib/audit-display";

const STORAGE_KEY = "masteros_notifications_last_seen";

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

function readLastSeen(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

function writeLastSeen(iso: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, iso);
}

function countUnread(logs: AuditLog[], lastSeenIso: string | null): number {
  if (!lastSeenIso) return 0;
  const t = new Date(lastSeenIso).getTime();
  return logs.filter((l) => new Date(l.created_at).getTime() > t).length;
}

export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await getSupabase()
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      const rows = (data ?? []) as AuditLog[];
      setLogs(rows);
      const seen = readLastSeen();
      setUnread(countUnread(rows, seen));
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const closePanel = useCallback(() => {
    writeLastSeen(new Date().toISOString());
    setUnread(0);
    setOpen(false);
  }, []);

  const openPanel = useCallback(() => {
    setOpen(true);
    void loadLogs();
  }, [loadLogs]);

  // First visit: baseline "seen" so the dot isn't stuck on old history
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!readLastSeen()) {
      writeLastSeen(new Date().toISOString());
    }
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    const onFocus = () => void loadLogs();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadLogs]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        closePanel();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, closePanel]);

  const togglePanel = () => {
    if (open) closePanel();
    else openPanel();
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={togglePanel}
        className={cn(
          "relative h-9 w-9 rounded-lg flex items-center justify-center transition-colors",
          open
            ? "bg-surface-tertiary text-text-primary ring-1 ring-primary/40"
            : "text-text-secondary hover:bg-surface-tertiary hover:text-text-primary",
        )}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Notifications"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-surface"
            aria-label={`${unread} unread notifications`}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[min(100vw-1.5rem,22rem)] rounded-xl border border-border-light bg-surface shadow-lg"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="flex items-center justify-between border-b border-border-light px-4 py-3">
            <p className="text-sm font-semibold text-text-primary">Notifications</p>
            <span className="text-[11px] text-text-tertiary">Recent activity</span>
          </div>

          <div className="max-h-[min(420px,70vh)] overflow-y-auto">
            {loading && logs.length === 0 && (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
              </div>
            )}

            {!loading && logs.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-text-tertiary">No activity yet.</div>
            )}

            {logs.map((log) => {
              const Icon = entityIcons[log.entity_type] ?? AlertTriangle;
              const href = auditLogHref(log);
              const title = buildAuditTitle(log);
              const desc = buildAuditDescription(log);
              const seen = readLastSeen();
              const isNew = seen && new Date(log.created_at).getTime() > new Date(seen).getTime();

              const inner = (
                <div
                  className={cn(
                    "flex gap-3 px-4 py-3 transition-colors hover:bg-surface-hover",
                    isNew && "bg-primary/[0.06]",
                  )}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-tertiary text-text-secondary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-medium text-text-primary line-clamp-2">{title}</p>
                    {desc ? <p className="mt-0.5 text-xs text-text-tertiary line-clamp-2">{desc}</p> : null}
                    <p className="mt-1 text-[11px] text-text-tertiary">
                      {log.user_name ?? "System"} · {formatRelativeTime(log.created_at)}
                    </p>
                  </div>
                  {isNew ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" title="New" /> : null}
                </div>
              );

              if (href) {
                return (
                  <Link
                    key={log.id}
                    href={href}
                    onClick={closePanel}
                    className="block border-b border-border-light last:border-b-0"
                  >
                    {inner}
                  </Link>
                );
              }

              return (
                <div key={log.id} className="border-b border-border-light last:border-b-0">
                  {inner}
                </div>
              );
            })}
          </div>

          <div className="border-t border-border-light px-4 py-2">
            <Link
              href="/"
              onClick={closePanel}
              className="text-xs font-medium text-primary hover:underline"
            >
              Open dashboard
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
