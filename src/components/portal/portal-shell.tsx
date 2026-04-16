"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, FileText, ClipboardList, Briefcase, Receipt,
  MessageSquare, Settings, LogOut, Menu, X, Sun, Moon,
} from "lucide-react";
import { PortalNotificationBell } from "./portal-notification-bell";

interface PortalShellProps {
  accountName: string;
  userEmail: string;
  userFullName: string | null;
  portalUserId: string;
  accountId: string;
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { href: "/portal",          label: "Dashboard", icon: LayoutDashboard },
  { href: "/portal/requests", label: "Requests",  icon: ClipboardList   },
  { href: "/portal/quotes",   label: "Quotes",    icon: FileText        },
  { href: "/portal/jobs",     label: "Jobs",      icon: Briefcase       },
  { href: "/portal/invoices", label: "Invoices",  icon: Receipt         },
  { href: "/portal/tickets",  label: "Tickets",   icon: MessageSquare   },
  { href: "/portal/settings", label: "Settings",  icon: Settings        },
];

function usePortalTheme() {
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = typeof window !== "undefined"
      ? (localStorage.getItem("master-os-theme") as "light" | "dark" | "system" | null)
      : null;
    const initial = stored ?? "system";
    const sysIsDark = typeof window !== "undefined"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false;
    const r: "light" | "dark" = initial === "system" ? (sysIsDark ? "dark" : "light") : initial;
    queueMicrotask(() => {
      setResolved(r);
      document.documentElement.classList.toggle("dark", r === "dark");
    });
  }, []);

  const toggle = useCallback(() => {
    setResolved((cur) => {
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      try { localStorage.setItem("master-os-theme", next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return { resolved, toggle };
}

function NavList({ onItemClick, isActive }: { onItemClick?: () => void; isActive: (href: string) => boolean }) {
  return (
    <nav className="flex-1 p-4 space-y-0.5">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onItemClick}
            className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              active
                ? "text-primary"
                : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            }`}
          >
            {active && (
              <motion.span
                layoutId="portal-sidebar-active"
                className="absolute inset-0 rounded-lg bg-primary-50 dark:bg-primary-700/15"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
            <Icon className="relative w-4 h-4 shrink-0" />
            <span className="relative">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function PortalShell({ accountName, userEmail, userFullName, portalUserId, accountId, children }: PortalShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { resolved, toggle } = usePortalTheme();

  const isActive = (href: string) => {
    if (href === "/portal") return pathname === "/portal";
    return pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen flex bg-surface-secondary text-text-primary">
      {/* Sidebar — desktop */}
      <aside className="hidden lg:flex w-64 bg-card border-r border-border flex-col">
        <div className="p-6 border-b border-border-light">
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="flex items-center gap-3"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://wearemaster.com/favicon.png"
              alt="Master"
              className="w-9 h-9 object-contain"
            />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">Master</p>
              <p className="text-sm font-bold text-text-primary truncate">{accountName || "Portal"}</p>
            </div>
          </motion.div>
        </div>

        <NavList isActive={isActive} />

        <div className="p-4 border-t border-border-light">
          <div className="px-3 py-2 mb-2">
            <p className="text-xs font-semibold text-text-primary truncate">{userFullName || userEmail}</p>
            <p className="text-xs text-text-tertiary truncate">{userEmail}</p>
          </div>
          <motion.button
            whileTap={{ scale: 0.97 }}
            type="button"
            onClick={toggle}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors mb-1"
          >
            {resolved === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            {resolved === "dark" ? "Light mode" : "Dark mode"}
          </motion.button>
          <form action="/api/portal/auth/sign-out" method="POST">
            <motion.button
              whileTap={{ scale: 0.97 }}
              type="submit"
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-hover hover:text-red-600 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </motion.button>
          </form>
        </div>
      </aside>

      {/* Mobile sidebar drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="lg:hidden fixed inset-0 z-50">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-black/50"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 34 }}
              className="absolute left-0 top-0 bottom-0 w-72 bg-card flex flex-col"
            >
              <div className="p-5 border-b border-border-light flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="https://wearemaster.com/favicon.png" alt="Master" className="w-9 h-9 object-contain" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">Master</p>
                    <p className="text-sm font-bold text-text-primary truncate">{accountName || "Portal"}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="p-2 rounded-lg hover:bg-surface-hover"
                >
                  <X className="w-5 h-5 text-text-tertiary" />
                </button>
              </div>
              <NavList isActive={isActive} onItemClick={() => setMobileOpen(false)} />
              <div className="p-4 border-t border-border-light">
                <div className="px-3 py-2 mb-2">
                  <p className="text-xs font-semibold text-text-primary truncate">{userFullName || userEmail}</p>
                  <p className="text-xs text-text-tertiary truncate">{userEmail}</p>
                </div>
                <button
                  type="button"
                  onClick={toggle}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors mb-1"
                >
                  {resolved === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                  {resolved === "dark" ? "Light mode" : "Dark mode"}
                </button>
                <form action="/api/portal/auth/sign-out" method="POST">
                  <button
                    type="submit"
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-hover hover:text-red-600 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign out
                  </button>
                </form>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden bg-card/80 backdrop-blur-md border-b border-border px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-lg hover:bg-surface-hover"
          >
            <Menu className="w-5 h-5 text-text-secondary" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="https://wearemaster.com/favicon.png" alt="Master" className="w-7 h-7 object-contain" />
          <p className="text-sm font-bold text-text-primary truncate flex-1">{accountName || "Portal"}</p>
          <PortalNotificationBell portalUserId={portalUserId} accountId={accountId} />
        </header>

        {/* Desktop top bar */}
        <header className="hidden lg:flex bg-card/80 backdrop-blur-md border-b border-border px-6 py-2.5 items-center justify-end gap-2 sticky top-0 z-30">
          <PortalNotificationBell portalUserId={portalUserId} accountId={accountId} />
        </header>

        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
