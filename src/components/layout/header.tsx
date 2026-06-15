"use client";

import { cn } from "@/lib/utils";
import { useSidebar } from "@/hooks/use-sidebar";
import { useProfile } from "@/hooks/use-profile";
import { Avatar } from "@/components/ui/avatar";
import { motion, AnimatePresence } from "framer-motion";
import {
  Settings, Menu, LogOut, Moon, Sun, Sparkles,
  Search, X, History,
} from "lucide-react";
import { NotificationsMenu } from "@/components/layout/notifications-menu";
import { Badge } from "@/components/ui/badge";
import { jobStatusBadgeVariant, jobStatusLabel } from "@/lib/job-status-ui";
import Link from "next/link";
import { useTheme } from "@/hooks/use-theme";
import { useState, useEffect, useRef, useCallback, type RefObject } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getSupabase } from "@/services/base";

// ── Global Search ────────────────────────────────────────────────────────────

type SearchResult = {
  id: string;
  type: "job" | "quote" | "request";
  title: string;
  subtitle: string;
  href: string;
  /** Raw status for jobs — shown as a badge on the result row. */
  status?: string;
};

function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    try {
      const supabase = getSupabase();
      const term = `%${q.trim()}%`;
      const jobOr = `reference.ilike.${term},title.ilike.${term},client_name.ilike.${term},property_address.ilike.${term}`;
      const quoteOr = `reference.ilike.${term},title.ilike.${term},client_name.ilike.${term},property_address.ilike.${term},postcode.ilike.${term}`;
      const requestOr = `reference.ilike.${term},client_name.ilike.${term},property_address.ilike.${term},postcode.ilike.${term},service_type.ilike.${term},description.ilike.${term}`;
      const [{ data: jobs }, { data: quotes }, { data: requests }] = await Promise.all([
        supabase
          .from("jobs")
          .select("id, reference, title, client_name, status, property_address")
          .or(jobOr)
          .is("deleted_at", null)
          .limit(5),
        supabase
          .from("quotes")
          .select("id, reference, title, client_name, status, property_address, postcode")
          .or(quoteOr)
          .is("deleted_at", null)
          .limit(5),
        supabase
          .from("service_requests")
          .select("id, reference, client_name, status, property_address, postcode, service_type, description")
          .or(requestOr)
          .is("deleted_at", null)
          .limit(5),
      ]);
      type RowBase = { id: string; reference: string; client_name: string; status: string };
      type JobRow = RowBase & { title: string; property_address?: string | null };
      type QuoteRow = RowBase & { title: string; property_address?: string | null; postcode?: string | null };
      type RequestRow = RowBase & {
        property_address?: string | null;
        postcode?: string | null;
        service_type?: string | null;
        description?: string | null;
      };
      const addrLine = (property_address?: string | null, postcode?: string | null) => {
        const a = (property_address ?? "").trim();
        const p = (postcode ?? "").trim();
        if (a && p) return `${a} · ${p}`;
        return a || p || "";
      };
      const mapped: SearchResult[] = [
        ...((jobs ?? []) as JobRow[]).map((j) => ({
          id: j.id,
          type: "job" as const,
          title: `${j.reference} – ${j.title}`,
          subtitle: [j.client_name, addrLine(j.property_address, null) || null].filter(Boolean).join(" · "),
          href: `/jobs/${j.id}`,
          status: j.status,
        })),
        ...((quotes ?? []) as QuoteRow[]).map((q2) => ({
          id: q2.id, type: "quote" as const,
          title: `${q2.reference} – ${q2.title}`,
          subtitle: [q2.client_name, addrLine(q2.property_address, q2.postcode) || null, q2.status].filter(Boolean).join(" · "),
          href: `/quotes?quoteId=${q2.id}`,
        })),
        ...((requests ?? []) as RequestRow[]).map((r) => ({
          id: r.id, type: "request" as const,
          title: `${r.reference} – ${(r.service_type ?? "").trim() || "Request"}`,
          subtitle: [r.client_name, addrLine(r.property_address, r.postcode) || null, r.status].filter(Boolean).join(" · "),
          href: `/requests?requestId=${r.id}`,
        })),
      ];
      setResults(mapped);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(() => search(query), 280);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ⌘K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (window.matchMedia("(min-width: 768px)").matches) {
          inputRef.current?.focus();
          setOpen(true);
        } else {
          setMobileOpen(true);
          setTimeout(() => mobileInputRef.current?.focus(), 50);
        }
      }
      if (e.key === "Escape") {
        setOpen(false);
        setMobileOpen(false);
        inputRef.current?.blur();
        mobileInputRef.current?.blur();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const t = setTimeout(() => mobileInputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [mobileOpen]);

  const typeIcon = (type: SearchResult["type"]) => {
    const colors: Record<SearchResult["type"], string> = {
      job: "bg-primary/20 text-primary",
      quote: "bg-emerald-400/20 text-emerald-500",
      request: "bg-amber-400/20 text-amber-500",
    };
    const labels: Record<SearchResult["type"], string> = { job: "J", quote: "Q", request: "R" };
    return (
      <span className={`text-[10px] font-bold ${colors[type]}`}>
        {labels[type]}
      </span>
    );
  };

  const typeLabel = (type: SearchResult["type"]) =>
    type === "job" ? "Job" : type === "quote" ? "Quote" : "Request";

  const closeSearch = () => {
    setOpen(false);
    setMobileOpen(false);
  };

  const pickResult = (href: string) => {
    closeSearch();
    setQuery("");
    router.push(href);
  };

  const resultsBody =
    query.trim().length < 2 ? null : loading ? (
      <div className="px-4 py-6 text-sm text-text-tertiary text-center">Searching…</div>
    ) : results.length === 0 ? (
      <div className="px-4 py-6 text-sm text-text-tertiary text-center">
        No results for <strong>&quot;{query}&quot;</strong>
      </div>
    ) : (
      <ul className="max-h-[min(60vh,20rem)] divide-y divide-border-light overflow-y-auto py-1">
        {results.map((r) => (
          <li key={`${r.type}-${r.id}`}>
            <button
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover"
              onMouseDown={(e) => {
                e.preventDefault();
                pickResult(r.href);
              }}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-tertiary">
                {typeIcon(r.type)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-primary">{r.title}</p>
                {r.subtitle ? (
                  <p className="truncate text-[11px] text-text-tertiary">{r.subtitle}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {r.type === "job" && r.status ? (
                  <Badge variant={jobStatusBadgeVariant(r.status)} size="sm" className="h-5 text-[10px]">
                    {jobStatusLabel(r.status)}
                  </Badge>
                ) : null}
                <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-text-tertiary">
                  {typeLabel(r.type)}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    );

  const searchInput = (ref: RefObject<HTMLInputElement | null>, autoFocus?: boolean) => (
    <div className="relative flex items-center">
      <Search className="pointer-events-none absolute left-3 h-4 w-4 text-text-secondary" />
      <input
        ref={ref}
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (query.trim().length >= 2) setOpen(true);
        }}
        placeholder="Search jobs, quotes, requests…"
        className="h-10 w-full rounded-lg border border-fx-line bg-surface pl-9 pr-10 text-[13px] text-text-primary shadow-sm placeholder:text-text-tertiary focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15"
      />
      {query ? (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            setResults([]);
            ref.current?.focus();
          }}
          className="absolute right-2.5 text-text-tertiary transition-colors hover:text-text-primary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <div ref={containerRef} className="relative hidden md:block">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3 h-4 w-4 text-text-secondary" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              if (query.trim().length >= 2) setOpen(true);
            }}
            placeholder="Search jobs, quotes, requests, address, postcode…"
            className="h-9 w-full max-w-96 rounded-lg border border-fx-line bg-surface pl-9 pr-16 text-[13px] text-text-primary shadow-sm placeholder:text-text-tertiary transition-all hover:border-fx-line/80 hover:bg-fx-paper focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setResults([]);
                inputRef.current?.focus();
              }}
              className="absolute right-2.5 text-text-tertiary transition-colors hover:text-text-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="absolute right-2.5 select-none rounded-sm border border-fx-line bg-fx-paper px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary">
              ⌘K
            </kbd>
          )}
        </div>

        {open && query.trim().length >= 2 ? (
          <div className="absolute left-0 top-full z-50 mt-1.5 w-[min(100vw-2rem,420px)] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
            {resultsBody}
            <div className="flex items-center gap-3 border-t border-border-light px-3 py-1.5 text-[10px] text-text-tertiary">
              <span>
                <kbd className="rounded border border-border bg-surface-hover px-1">↵</kbd> open
              </span>
              <span>
                <kbd className="rounded border border-border bg-surface-hover px-1">Esc</kbd> close
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {/* Mobile */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-tertiary md:hidden"
        aria-label="Search"
      >
        <Search className="h-5 w-5" />
      </button>

      {mobileOpen ? (
        <div className="fixed inset-0 z-[60] md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close search"
            onClick={closeSearch}
          />
          <div className="absolute inset-x-0 top-0 border-b border-fx-line bg-surface p-3 shadow-lg">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">{searchInput(mobileInputRef, true)}</div>
              <button
                type="button"
                onClick={closeSearch}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-tertiary"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {resultsBody ? <div className="mt-2 overflow-hidden rounded-xl border border-border-light">{resultsBody}</div> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

export function Header() {
  const pathname = usePathname();
  const { toggleMobile } = useSidebar();
  const { profile } = useProfile();
  const { resolved, toggle: toggleTheme } = useTheme();
  const activityLogActive = pathname === "/activity" || pathname.startsWith("/activity/");
  const displayName = profile?.full_name || "User";
  const displayRole = profile?.role
    ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1)
    : "";

  const handleSignOut = () => {
    window.location.assign("/auth/sign-out");
  };

  return (
    <motion.header
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className={cn(
        "z-20 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-fx-line bg-surface px-3 transition-all duration-300 sm:gap-3 sm:px-6",
      )}
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        <button
          onClick={toggleMobile}
          className="lg:hidden h-9 w-9 rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-tertiary transition-colors"
        >
          <Menu className="h-5 w-5" />
        </button>
        <GlobalSearch />
      </div>

      <div className="flex shrink-0 items-center gap-0.5 sm:gap-2">
        <button
          onClick={toggleTheme}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text-primary"
          title={resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          <AnimatePresence mode="wait" initial={false}>
            {resolved === "dark" ? (
              <motion.div key="sun" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.15 }}>
                <Sun className="h-[18px] w-[18px]" />
              </motion.div>
            ) : (
              <motion.div key="moon" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.15 }}>
                <Moon className="h-[18px] w-[18px]" />
              </motion.div>
            )}
          </AnimatePresence>
        </button>
        <Link
          href="/activity"
          className={cn(
            "hidden h-9 w-9 items-center justify-center rounded-lg transition-colors sm:flex",
            activityLogActive
              ? "bg-primary/15 text-primary"
              : "text-text-secondary hover:bg-surface-tertiary hover:text-text-primary",
          )}
          title="Activity log"
          aria-label="Activity log"
        >
          <History className="h-[18px] w-[18px]" />
        </Link>
        <NotificationsMenu />
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("master-brain-open"))}
          className="h-9 w-9 rounded-lg flex items-center justify-center text-text-secondary hover:bg-primary/10 hover:text-primary transition-colors"
          title="Fixfy Brain"
        >
          <Sparkles className="h-[18px] w-[18px]" />
        </button>
        <Link
          href="/settings"
          className="h-9 w-9 rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-tertiary hover:text-text-primary transition-colors"
        >
          <Settings className="h-[18px] w-[18px]" />
        </Link>
        <div className="mx-0.5 hidden h-6 w-px bg-border sm:mx-1 sm:block" />
        <div className="flex items-center gap-2.5 pl-1">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-text-primary leading-tight">{displayName}</p>
            {displayRole && (
              <p className="text-[11px] text-text-tertiary">{displayRole}</p>
            )}
          </div>
          <Avatar name={displayName} size="sm" />
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="h-9 w-9 rounded-lg flex items-center justify-center text-text-tertiary hover:bg-danger-light hover:text-red-500 transition-colors"
          title="Sign out"
        >
          <LogOut className="h-[18px] w-[18px]" />
        </button>
      </div>
    </motion.header>
  );
}