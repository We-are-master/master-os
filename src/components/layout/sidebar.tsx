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
  SquareKanban,
  Bot,
  Gauge,
  Scale,
  Tag,
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
  kanban: SquareKanban,
  bot: Bot,
  gauge: Gauge,
  scale: Scale,
  tag: Tag,
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
// /agents e /services são abas do Settings (14/10/2026); o menu salvo no banco ainda os traz.
const SIDEBAR_HIDDEN_HREFS = new Set(["/requests", "/compliance", "/ppm", "/school", "/leads", "/agents", "/services"]);

/** Páginas que são abas do Settings (Agents, Services): acendem o Settings na lateral. */
const SETTINGS_TAB_PATHS = ["/agents", "/services"];

function pathMatchesHref(pathname: string, href: string): boolean {
  if (href === "/settings" && SETTINGS_TAB_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
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
    rowHighlight ? "text-nav-text-strong" : "text-nav-text group-hover:text-nav-text-strong"
  );

  return (
    <Link href={item.href} onClick={onNavigate}>
      <motion.div
        className={cn(
          // VOS UNO sidebar item: 5×8, radius 6, 14/500, gap 9; active 600 with the 3px coral rule.
          "group relative flex items-center gap-[9px] rounded-[6px] text-[14px] font-medium transition-colors duration-150",
          nested
            ? "ml-2 border-l border-nav-border-strong py-[4px] pl-5 pr-2 text-[13px]"
            : "px-2 py-[5px]",
          collapsed && "justify-center px-2",
          rowHighlight
            ? "text-nav-text-strong bg-nav-active-bg font-semibold"
            : "text-nav-text hover:text-nav-text-strong hover:bg-nav-hover"
        )}
      >
        {showStripe && (
          <div
            className={cn(
              "absolute w-[3px] rounded-r bg-nav-accent",
              nested ? "-left-2 top-[5px] bottom-[5px]" : "-left-3 top-[5px] bottom-[5px]"
            )}
          />
        )}
        {LogoComponent ? (
          <LogoComponent className={iconClassName} />
        ) : (
          <Icon className={iconClassName} />
        )}
        {/* initial={false}: ao recarregar o nome já nasce visível. Com a animação de entrada
            o HTML do servidor vinha com opacidade 0 e o menu ficava só com ícones até o JS. */}
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              className="truncate whitespace-nowrap"
            >
              {item.label}
            </motion.span>
          )}
        </AnimatePresence>
        {!collapsed && item.badge && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="ml-auto rounded-[6px] bg-white/10 px-2 py-[2px] text-[11px] font-medium text-nav-text-strong"
          >
            {item.badge}
          </motion.span>
        )}
      </motion.div>
    </Link>
  );
}

function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  const { resolved, style } = useTheme();
  const logos = useCompanyLogos();
  // A logo do PDF (company_settings.logo_url) não serve à lateral: tem margem e cores do papel, e
  // trocava a logo oficial depois do carregamento (dono, 25/10/2026: "bug na logo quando recarrega").
  // A lateral só troca se houver logo de tema (claro/escuro) cadastrada para o app.
  const logoSrc = !logos.loading ? resolveAppLogoUrl(resolved, { ...logos, logoUrl: undefined }, style) : undefined;
  const [imgErr, setImgErr] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setImgErr(false));
  }, [logoSrc, resolved, style]);

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
            collapsed ? "h-8 w-8 rounded-[8px]" : "h-10 w-[140px] object-left"
          )}
          width={collapsed ? 32 : 140}
          height={collapsed ? 32 : 40}
          onError={() => setImgErr(true)}
        />
      ) : (
        <>
          {collapsed ? (
            <img src="/favicon.svg" alt={title} width={32} height={32} className="h-8 w-8 shrink-0 rounded-[8px]" />
          ) : (
            // width/height no HTML: a logo nasce com 140×40 mesmo antes do CSS chegar.
            <img src="/logos/fixfy-wordmark-white-trim.png" alt={title} width={140} height={40} className="h-10 w-[140px] shrink-0 object-contain object-left" />
          )}
        </>
      )}
    </Link>
  );
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
      {navGroups.map((group, groupIndex) => {
        const visibleItems = group.items.filter((item) => !SIDEBAR_HIDDEN_HREFS.has(item.href));
        // Linha só entre blocos visíveis: o 1º grupo pode estar todo oculto e a
        // linha dele colava na borda do logo (linha duplicada).
        const firstVisible = navGroups.findIndex((g) => g.items.some((i) => !SIDEBAR_HIDDEN_HREFS.has(i.href)));
        // A group whose every item is hidden would otherwise leave its heading
        // floating alone (what "Learn" did once Fixfy School was pulled).
        if (visibleItems.length === 0) return null;
        return (
        <div key={group.label}>
          {/* Sem título de grupo (VOS): uma linha fina separa os blocos. */}
          {groupIndex > firstVisible ? <div className="mx-2 my-2 h-px bg-[var(--nav-border)]" role="separator" /> : null}
          {(

            <div className="space-y-0.5">
              {visibleItems
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
        );
      })}
    </>
  );
}

export function Sidebar() {
  const { collapsed, toggle, mobileOpen, closeMobile } = useSidebar();
  const adminConfig = useAdminConfigOptional();
  // filteredNavigation already merges canonical items AND applies the
  // permission filter (use-admin-config). Falling back to the full NAVIGATION
  // is only for contexts rendered outside the provider — never as an escape
  // hatch when the filter returns few items.
  const navGroups = useMemo(
    () => (adminConfig ? adminConfig.filteredNavigation : NAVIGATION),
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
      {/* Logo numa caixa de 140 x 40 px (dono, 15/10/2026). */}
      <div className={cn("flex h-12 items-center border-b border-nav-border px-4", opts.collapsed && "justify-center px-2")}>
        <SidebarBrand collapsed={opts.collapsed} />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pt-2 pb-3 space-y-2">
        <SidebarNavGroups
          navGroups={navGroups}
          collapsed={opts.collapsed}
          collapsedSections={collapsedSections}
          setCollapsedSections={setCollapsedSections}
          onNavigate={opts.onNavigate}
        />
      </nav>

      {opts.showCollapse && (
        <div className="p-3 border-t border-nav-border">
          <button
            onClick={toggle}
            className="w-full flex items-center justify-center h-[30px] rounded-[6px] text-nav-muted hover:text-nav-text-strong hover:bg-nav-hover transition-colors"
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
        animate={{ width: collapsed ? 66 : 216 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="fixed left-0 top-0 bottom-0 z-50 bg-nav-bg hidden lg:flex flex-col border-r border-nav-border"
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
              className="absolute left-0 top-0 bottom-0 w-[min(18rem,85vw)] bg-nav-bg flex flex-col border-r border-nav-border shadow-2xl"
            >
              <div className="flex items-center justify-end px-3 pt-3 lg:hidden">
                <button
                  type="button"
                  onClick={closeMobile}
                  className="h-9 w-9 rounded-lg flex items-center justify-center text-nav-text hover:text-nav-text-strong hover:bg-nav-hover transition-colors"
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
