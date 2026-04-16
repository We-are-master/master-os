"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, CheckCheck } from "lucide-react";
import { useAccountScopedRealtime } from "@/hooks/portal/use-portal-realtime";

interface PortalNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link_url: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

interface PortalNotificationBellProps {
  /** Current portal user id — used for the realtime filter. */
  portalUserId: string;
  /** Portal account id — used for realtime filter + API scoping. */
  accountId: string;
}

function fmtRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/**
 * In-portal notification bell. Polls once on mount, then stays live via
 * Supabase Realtime scoped to the portal user's account. Click a row to
 * navigate AND mark it read; "Mark all read" clears the counter.
 */
export function PortalNotificationBell({ portalUserId, accountId }: PortalNotificationBellProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PortalNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Shake the bell whenever unread count increases (new notification arrived)
  const prevUnread = useRef(0);
  const [shakeKey, setShakeKey] = useState(0);
  useEffect(() => {
    if (unread > prevUnread.current) setShakeKey((k) => k + 1);
    prevUnread.current = unread;
  }, [unread]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/portal/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { notifications: PortalNotification[]; unread: number };
      setItems(json.notifications ?? []);
      setUnread(json.unread ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useAccountScopedRealtime({
    table: "portal_notifications",
    filter: `account_id=eq.${accountId}`,
    event: "*",
    channelSuffix: portalUserId,
    onChange: () => void refresh(),
  });

  useEffect(() => {
    if (!open) return;
    const onClickOut = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOut);
    return () => document.removeEventListener("mousedown", onClickOut);
  }, [open]);

  const markRead = async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n)));
    setUnread((u) => Math.max(0, u - 1));
    try { await fetch(`/api/portal/notifications/${id}/read`, { method: "POST" }); } catch { /* ignore */ }
  };

  const markAllRead = async () => {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    setUnread(0);
    try { await fetch("/api/portal/notifications/read-all", { method: "POST" }); } catch { /* ignore */ }
  };

  const handleClick = (n: PortalNotification) => {
    if (!n.read_at) void markRead(n.id);
    setOpen(false);
    if (n.link_url) router.push(n.link_url);
  };

  return (
    <div ref={wrapRef} className="relative">
      <motion.button
        whileTap={{ scale: 0.94 }}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-lg hover:bg-surface-hover text-text-secondary transition-colors"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
      >
        <motion.span
          key={shakeKey}
          animate={shakeKey > 0 ? { rotate: [0, -12, 12, -8, 8, 0] } : { rotate: 0 }}
          transition={{ duration: 0.55, times: [0, 0.2, 0.4, 0.6, 0.8, 1] }}
          className="inline-flex origin-top"
        >
          <Bell className="w-5 h-5" />
        </motion.span>
        <AnimatePresence>
          {unread > 0 && (
            <motion.span
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 22 }}
              className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center shadow-sm shadow-primary/40"
            >
              {unread > 9 ? "9+" : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="absolute right-0 top-full mt-1 w-[min(90vw,360px)] rounded-xl border border-border bg-card shadow-xl z-50 overflow-hidden origin-top-right"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-light">
              <p className="text-sm font-semibold text-text-primary">Notifications</p>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"
                >
                  <CheckCheck className="w-3 h-3" />
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-[60vh] overflow-y-auto">
              {loading && items.length === 0 && (
                <p className="px-4 py-8 text-center text-xs text-text-tertiary">Loading...</p>
              )}
              {!loading && items.length === 0 && (
                <p className="px-4 py-10 text-center text-xs text-text-tertiary">
                  You&rsquo;re all caught up.
                </p>
              )}
              {items.map((n, idx) => {
                const isUnread = !n.read_at;
                const body = (
                  <motion.div
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2, delay: idx * 0.02 }}
                    className="flex items-start gap-3 px-4 py-3 text-left hover:bg-surface-hover transition-colors w-full"
                  >
                    <span
                      className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${
                        isUnread ? "bg-primary" : "bg-transparent"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${isUnread ? "font-semibold text-text-primary" : "text-text-secondary"}`}>
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="text-xs text-text-tertiary truncate">{n.body}</p>
                      )}
                      <p className="text-[10px] text-text-tertiary mt-0.5">{fmtRelative(n.created_at)}</p>
                    </div>
                    {isUnread && (
                      <span className="text-[10px] text-primary font-bold self-start mt-1 tracking-wider">NEW</span>
                    )}
                  </motion.div>
                );

                return n.link_url ? (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleClick(n)}
                    className="w-full text-left"
                  >
                    {body}
                  </button>
                ) : (
                  <div key={n.id} className="w-full text-left cursor-default">{body}</div>
                );
              })}
            </div>

            <div className="px-4 py-2 border-t border-border-light text-center">
              <Link
                href="/portal"
                onClick={() => setOpen(false)}
                className="text-[11px] text-text-tertiary hover:text-text-primary"
              >
                View portal home
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
