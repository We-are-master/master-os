"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { APP_NAME, NAVIGATION, type NavItem } from "@/lib/constants";
import { useSidebar } from "@/hooks/use-sidebar";
import { useAdminConfigOptional } from "@/hooks/use-admin-config";
import { useTheme } from "@/hooks/use-theme";
import { useCompanyLogos, resolveAppLogoUrl } from "@/hooks/use-company-logos";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutGrid,
  Inbox,
  FileText,
  Briefcase,
  Calendar,
  GitBranch,
  Building2,
  Users,
  UsersRound,
  Building,
  Receipt,
  Wallet,
  Settings,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  X,
  Layers,
  UserCircle,
  CircleDollarSign,
  FileCheck,
  CalendarClock,
  Wrench,
  History,
  ContactRound,
  MessageSquare,
  MailPlus,
  MapPin,
  GraduationCap,
  type LucideIcon,
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = {
  "grid-2x2": LayoutGrid,
  inbox: Inbox,
  "file-text": FileText,
  briefcase: Briefcase,
  calendar: Calendar,
  "git-branch": GitBranch,
  "building-2": Building2,
  users: Users,
  "users-2": UsersRound,
  building: Building,
  receipt: Receipt,
  wallet: Wallet,
  "file-check": FileCheck,
  "calendar-clock": CalendarClock,
  settings: Settings,
  "user-circle": UserCircle,
  "circle-dollar-sign": CircleDollarSign,
  wrench: Wrench,
  history: History,
  contact: ContactRound,
  "message-square": MessageSquare,
  "mail-plus": MailPlus,
  "map-pin": MapPin,
  "graduation-cap": GraduationCap,
};

/** Logos (SVG inline para herdar currentColor) para Partners, Accounts */
function LogoPartners({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function LogoAccounts({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </svg>
  );
}

const navLogoComponents: Record<string, (props: { className?: string }) => React.ReactElement> = {
  "/partners": LogoPartners,
  "/accounts": LogoAccounts,
};

/** URLs that stay reachable by direct link but are not shown in the sidebar. */
const SIDEBAR_HIDDEN_HREFS = new Set(["/clients", "/requests", "/compliance", "/ppm"]);

function pathMatchesHref(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/" && pathname.startsWith(href));
}

function NavLink({
  item,
  collapsed,
  nested = false,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  nested?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const childActive = item.children?.some((c) => pathMatchesHref(pathname, c.href)) ?? false;
  const selfActive = pathMatchesHref(pathname, item.href);
  const isParentOfActive = !nested && Boolean(item.children?.length) && childActive && !selfActive;
  const rowHighlight = nested ? selfActive : selfActive || isParentOfActive;
  const showStripe = selfActive;

  const Icon = iconMap[item.icon] || LayoutGrid;
  const LogoComponent = navLogoComponents[item.href];
  const iconClassName = cn(
    "h-4 w-4 shrink-0 transition-colors",
    rowHighlight ? "text-fx-coral opacity-100" : "text-white/60 opacity-85 group-hover:text-white"
  );

  return (
    <Link href={item.href} onClick={onNavigate}>
      <motion.div
        whileHover={{ x: nested ? 0 : 2 }}
        whileTap={{ scale: 0.98 }}
        className={cn(
          "group relative flex items-center gap-2.5 rounded-md text-[13.5px] font-medium transition-colors duration-200",
          nested ? "pl-6 pr-2.5 py-1.5 ml-2 border-l border-white/10" : "px-2.5 py-2",
          collapsed && "justify-center px-2",
          rowHighlight
            ? "text-white bg-fx-coral/10"
            : "text-white/60 hover:text-white/90 hover:bg-white/[0.04]"
        )}
      >
        {showStripe && (
          <motion.div
            layoutId={nested ? `sidebar-active-${item.href}` : "sidebar-active"}
            className={cn(
              "absolute w-[3px] bg-fx-coral rounded-r",
              nested ? "-left-2 top-1.5 bottom-1.5" : "-left-3 top-1.5 bottom-1.5"
            )}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          />
        )}
        {LogoComponent ? (
          <LogoComponent className={iconClassName} />
        ) : (
          <Icon className={iconClassName} />
        )}
        <AnimatePresence>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              className={cn("truncate whitespace-nowrap", nested && "text-[13px] font-medium")}
            >
              {item.label}
            </motion.span>
          )}
        </AnimatePresence>
        {!collapsed && item.badge && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="ml-auto fx-kk text-fx-coral bg-fx-coral/15 px-1.5 py-0.5 rounded-sm"
          >
            {item.badge}
          </motion.span>
        )}
      </motion.div>
    </Link>
  );
}

function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  const { resolved } = useTheme();
  const logos = useCompanyLogos();
  const logoSrc = !logos.loading ? resolveAppLogoUrl(resolved, logos) : undefined;
  const [imgErr, setImgErr] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setImgErr(false));
  }, [logoSrc, resolved]);

  const title = logos.companyName?.trim() || APP_NAME;
  const showCustom = Boolean(logoSrc && !imgErr);

  return (
    <Link href="/" className={cn("flex items-center min-w-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/40", collapsed ? "justify-center" : "gap-2.5")}>
      {showCustom ? (
        <img
          src={logoSrc}
          alt={title}
          className={cn(
            "object-contain object-left shrink-0",
            collapsed ? "h-9 w-9 rounded-lg" : "h-9 max-h-9 max-w-[200px] w-auto"
          )}
          onError={() => setImgErr(true)}
        />
      ) : (
        <>
          <div className="h-6 w-6 rounded-md bg-fx-coral flex items-center justify-center shrink-0 font-mono font-semibold text-[13px] text-white leading-none">
            f
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                className="overflow-hidden"
              >
                <span className="text-[15px] font-semibold text-white tracking-[-0.01em] whitespace-nowrap">
                  {title}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </Link>
  );
}

function markItemHrefsDeep(item: NavItem, sink: Set<string>): void {
  sink.add(item.href);
  item.children?.forEach((c) => markItemHrefsDeep(c, sink));
}

/**
 * Merge new items from the canonical NAVIGATION into the admin-filtered
 * list (including nested `children`).
 */
function mergeNewNavItems(
  filtered: typeof NAVIGATION,
  canonical: typeof NAVIGATION,
): typeof NAVIGATION {
  const filteredHrefs = new Set<string>();
  filtered.forEach((g) => g.items.forEach((i) => markItemHrefsDeep(i, filteredHrefs)));

  const result = filtered.map((g) => ({
    ...g,
    items: g.items.map((item) => ({
      ...item,
      children: item.children?.length ? item.children.map((c) => ({ ...c })) : undefined,
    })),
  }));

  const findGroup = (label: string) => result.find((g) => g.label === label);

  for (const cGroup of canonical) {
    let match = findGroup(cGroup.label);
    if (!match) {
      match = { label: cGroup.label, items: [] };
      result.push(match);
    }
    for (const cItem of cGroup.items) {
      const local = match!.items.find((i) => i.href === cItem.href);
      if (!local) {
        match!.items.push({
          ...cItem,
          children: cItem.children?.map((ch) => ({ ...ch })),
        });
        markItemHrefsDeep(cItem, filteredHrefs);
        continue;
      }

      filteredHrefs.add(cItem.href);
      if (cItem.children?.length) {
        const kids = [...(local.children ?? [])];
        for (const ch of cItem.children) {
          if (!kids.some((k) => k.href === ch.href)) kids.push({ ...ch });
          filteredHrefs.add(ch.href);
        }
        local.children = kids.length > 0 ? kids : undefined;
      }
    }
  }

  const order = new Map(canonical.map((g, i) => [g.label, i]));
  result.sort((a, b) => (order.get(a.label) ?? 999) - (order.get(b.label) ?? 999));
  return result;
}

function SidebarNavGroups({
  navGroups,
  collapsed,
  collapsedSections,
  setCollapsedSections,
  onNavigate,
}: {
  navGroups: typeof NAVIGATION;
  collapsed: boolean;
  collapsedSections: Record<string, boolean>;
  setCollapsedSections: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onNavigate?: () => void;
}) {
  return (
    <>
      {navGroups.map((group) => (
        <div key={group.label}>
          <AnimatePresence>
            {!collapsed && (
              <motion.button
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() =>
                  setCollapsedSections((prev) => ({
                    ...prev,
                    [group.label]: !prev[group.label],
                  }))
                }
                className="group mb-2 flex w-full items-center justify-between px-2 font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-white/40 transition-colors hover:text-white/60"
              >
                <span>{group.label}</span>
                {collapsedSections[group.label] ? (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
                )}
              </motion.button>
            )}
          </AnimatePresence>
          {(collapsed || !collapsedSections[group.label]) && (
            <div className="space-y-0.5">
              {group.items
                .filter((item) => !SIDEBAR_HIDDEN_HREFS.has(item.href))
                .map((item) => (
                  <div key={item.href} className="space-y-0.5">
                    <NavLink item={item} collapsed={collapsed} onNavigate={onNavigate} />
                    {!collapsed &&
                      item.children
                        ?.filter((ch) => !SIDEBAR_HIDDEN_HREFS.has(ch.href))
                        .map((ch) => (
                          <NavLink
                            key={ch.href}
                            item={ch}
                            collapsed={collapsed}
                            nested
                            onNavigate={onNavigate}
                          />
                        ))}
                  </div>
                ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

export function Sidebar() {
  const { collapsed, toggle, mobileOpen, closeMobile } = useSidebar();
  const adminConfig = useAdminConfigOptional();
  const navGroups = useMemo(
    () =>
      adminConfig?.filteredNavigation?.length
        ? mergeNewNavItems(adminConfig.filteredNavigation, NAVIGATION)
        : NAVIGATION,
    [adminConfig],
  );
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const sectionLabelsSig = useMemo(
    () => navGroups.map((group) => group.label).join("|"),
    [navGroups],
  );

  useEffect(() => {
    queueMicrotask(() => {
      setCollapsedSections((prev) => {
        const next: Record<string, boolean> = {};
        for (const group of navGroups) {
          next[group.label] = prev[group.label] ?? false;
        }
        const sameKeys = Object.keys(next).length === Object.keys(prev).length;
        const sameValues = sameKeys && Object.keys(next).every((k) => next[k] === prev[k]);
        return sameValues ? prev : next;
      });
    });
  }, [sectionLabelsSig, navGroups]);

  const sidebarShell = (opts: { collapsed: boolean; showCollapse: boolean; onNavigate?: () => void }) => (
    <>
      <div className={cn("flex items-center h-14 px-5 pt-1", opts.collapsed && "justify-center px-2")}>
        <SidebarBrand collapsed={opts.collapsed} />
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
        <SidebarNavGroups
          navGroups={navGroups}
          collapsed={opts.collapsed}
          collapsedSections={collapsedSections}
          setCollapsedSections={setCollapsedSections}
          onNavigate={opts.onNavigate}
        />
      </nav>

      {opts.showCollapse && (
        <div className="p-3 border-t border-white/5">
          <button
            onClick={toggle}
            className="w-full flex items-center justify-center h-9 rounded-lg text-sidebar-text-muted hover:text-white hover:bg-white/5 transition-colors"
          >
            <motion.div
              animate={{ rotate: opts.collapsed ? 180 : 0 }}
              transition={{ duration: 0.3 }}
            >
              <ChevronLeft className="h-4 w-4" />
            </motion.div>
          </button>
        </div>
      )}
    </>
  );

  return (
    <>
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 72 : 256 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="fixed left-0 top-0 bottom-0 z-50 bg-fx-navy-2 hidden lg:flex flex-col border-r border-white/[0.04]"
      >
        {sidebarShell({ collapsed, showCollapse: true })}
      </motion.aside>

      <AnimatePresence>
        {mobileOpen && (
          <div className="lg:hidden fixed inset-0 z-[60]">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/50"
              onClick={closeMobile}
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
              className="absolute left-0 top-0 bottom-0 w-[min(18rem,85vw)] bg-fx-navy-2 flex flex-col border-r border-white/[0.04] shadow-2xl"
            >
              <div className="flex items-center justify-end px-3 pt-3 lg:hidden">
                <button
                  type="button"
                  onClick={closeMobile}
                  className="h-9 w-9 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="Close menu"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {sidebarShell({ collapsed: false, showCollapse: false, onNavigate: closeMobile })}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
