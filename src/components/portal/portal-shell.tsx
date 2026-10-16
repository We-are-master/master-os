"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, FileText, ClipboardList, Briefcase, Receipt,
  MessageSquare, Settings, LogOut, Menu, X,
} from "lucide-react";

interface PortalShellProps {
  accountName: string;
  userEmail: string;
  userFullName: string | null;
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

/** Light only, like the rest of the OS: drops any saved dark preference and keeps the style flag. */
function usePortalLightOnly() {
  useEffect(() => {
    queueMicrotask(() => {
      document.documentElement.classList.remove("dark");
      try { localStorage.removeItem("master-os-theme"); } catch { /* ignore */ }
      if (localStorage.getItem("master-os-style") === "minimal") {
        document.documentElement.setAttribute("data-style", "minimal");
      } else {
        document.documentElement.removeAttribute("data-style");
      }
    });
  }, []);
}

export function PortalShell({ accountName, userEmail, userFullName, children }: PortalShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  usePortalLightOnly();

  const isActive = (href: string) => {
    if (href === "/portal") return pathname === "/portal";
    return pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen flex bg-surface-secondary text-text-primary">
      {/* Sidebar — desktop */}
      <aside className="hidden lg:flex w-64 bg-card border-r border-border flex-col">
        <div className="p-6 border-b border-border-light">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/favicon.svg"
              alt="Fixfy"
              className="w-9 h-9 object-contain"
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Fixfy</p>
              <p className="text-sm font-bold text-text-primary truncate">{accountName || "Portal"}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary-50 text-primary-700 dark:bg-primary-700/15 dark:text-primary-500"
                    : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border-light">
          <div className="px-3 py-2 mb-2">
            <p className="text-xs font-semibold text-text-primary truncate">{userFullName || userEmail}</p>
            <p className="text-xs text-text-tertiary truncate">{userEmail}</p>
          </div>
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
      </aside>

      {/* Mobile sidebar drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-card flex flex-col">
            <div className="p-5 border-b border-border-light flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/favicon.svg" alt="Fixfy" className="w-9 h-9 object-contain" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">Fixfy</p>
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
            <nav className="flex-1 p-4 space-y-1">
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                const active = isActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? "bg-primary-50 text-primary-700 dark:bg-primary-700/15 dark:text-primary-500"
                        : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </Link>
                );
              })}
            </nav>
            <div className="p-4 border-t border-border-light">
              <div className="px-3 py-2 mb-2">
                <p className="text-xs font-semibold text-text-primary truncate">{userFullName || userEmail}</p>
                <p className="text-xs text-text-tertiary truncate">{userEmail}</p>
              </div>
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
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden bg-card border-b border-border px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-lg hover:bg-surface-hover"
          >
            <Menu className="w-5 h-5 text-text-secondary" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="Fixfy" className="w-7 h-7 object-contain" />
          <p className="text-sm font-bold text-text-primary truncate">{accountName || "Portal"}</p>
        </header>

        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
