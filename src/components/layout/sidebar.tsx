"use client";

import { cn } from "@/lib/utils";
import { NAVIGATION, type NavItem } from "@/lib/constants";
import { useSidebar } from "@/hooks/use-sidebar";
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
  Building,
  Receipt,
  Wallet,
  Settings,
  ChevronLeft,
  Layers,
  UserCircle,
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
  building: Building,
  receipt: Receipt,
  wallet: Wallet,
  settings: Settings,
  "user-circle": UserCircle,
};

function NavLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const pathname = usePathname();
  const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
  const Icon = iconMap[item.icon] || LayoutGrid;

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
        <Icon
          className={cn(
            "h-[18px] w-[18px] shrink-0 transition-colors",
            isActive ? "text-primary" : "text-sidebar-text-muted group-hover:text-stone-300"
          )}
        />
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

export function Sidebar() {
  const { collapsed, toggle } = useSidebar();

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 72 : 256 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      className="fixed left-0 top-0 bottom-0 z-30 bg-sidebar flex flex-col border-r border-white/5"
    >
      <div className={cn("flex items-center h-16 px-4 border-b border-white/5", collapsed && "justify-center px-2")}>
        <div className="flex items-center gap-2.5">
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
                  Master OS
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
        {NAVIGATION.map((group) => (
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
