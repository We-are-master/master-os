"use client";

import { useEffect, useState } from "react";
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
  Layers,
  UserCircle,
  CircleDollarSign,
  FileCheck,
  CalendarClock,
  Wrench,
  History,
  ContactRound,
  MessageSquare,
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
};

/** Logos (SVG inline para herdar currentColor) para Clients, Partners, Accounts */
function LogoClients({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6" />
    </svg>
  );
}
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
  "/clients": LogoClients,
  "/partners": LogoPartners,
  "/accounts": LogoAccounts,
};

function NavLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const pathname = usePathname();
  const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
  const Icon = iconMap[item.icon] || LayoutGrid;
  const LogoComponent = navLogoComponents[item.href];
  const iconClassName = cn(
    "h-[18px] w-[18px] shrink-0 transition-colors",
    isActive ? "text-primary" : "text-sidebar-text-muted group-hover:text-stone-300"
  );

  return (
    <Link href={item.href}>
      <motion.div
        whileHover={{ x: 2 }}
        whileTap={{ scale: 0.98 }}
        className={cn(
          "group relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
          collapsed && "justify-center px-2",
          isActive
            ? "text-white bg-white/10"
            : "text-sidebar-text hover:text-white hover:bg-white/5"
        )}
      >
        {isActive && (
          <motion.div
            layoutId="sidebar-active"
            className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-primary rounded-r-full"
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
            className="ml-auto text-[10px] font-bold bg-primary/20 text-primary px-1.5 py-0.5 rounded-md"
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
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <Layers className="h-4 w-4 text-white" />
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                className="overflow-hidden"
              >
                <span className="text-base font-bold text-white tracking-tight whitespace-nowrap">
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

export function Sidebar() {
  const { collapsed, toggle } = useSidebar();
  const adminConfig = useAdminConfigOptional();
  const navGroups = adminConfig?.filteredNavigation?.length
    ? adminConfig.filteredNavigation
    : NAVIGATION;

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 72 : 256 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      className="fixed left-0 top-0 bottom-0 z-30 bg-sidebar flex flex-col border-r border-white/5"
    >
      <div className={cn("flex items-center h-16 px-4 border-b border-white/5", collapsed && "justify-center px-2")}>
        <SidebarBrand collapsed={collapsed} />
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
        {navGroups.map((group) => (
          <div key={group.label}>
            <AnimatePresence>
              {!collapsed && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="px-3 mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-sidebar-text-muted"
                >
                  {group.label}
                </motion.p>
              )}
            </AnimatePresence>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} collapsed={collapsed} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-white/5">
        <button
          onClick={toggle}
          className="w-full flex items-center justify-center h-9 rounded-lg text-sidebar-text-muted hover:text-white hover:bg-white/5 transition-colors"
        >
          <motion.div
            animate={{ rotate: collapsed ? 180 : 0 }}
            transition={{ duration: 0.3 }}
          >
            <ChevronLeft className="h-4 w-4" />
          </motion.div>
        </button>
      </div>
    </motion.aside>
  );
}
