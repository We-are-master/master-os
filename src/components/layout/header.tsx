"use client";

import { cn } from "@/lib/utils";
import { useSidebar } from "@/hooks/use-sidebar";
import { useProfile } from "@/hooks/use-profile";
import { SearchInput } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, Menu, LogOut, Moon, Sun, Sparkles } from "lucide-react";
import { NotificationsMenu } from "@/components/layout/notifications-menu";
import Link from "next/link";
import { useTheme } from "@/hooks/use-theme";

export function Header() {
  const { collapsed, toggleMobile } = useSidebar();
  const { profile } = useProfile();
  const { resolved, toggle: toggleTheme } = useTheme();
  const displayName = profile?.full_name || "User";
  const displayRole = profile?.role
    ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1)
    : "";

  /** Server route clears Supabase cookies — client-only signOut often leaves middleware still “logged in”. */
  const handleSignOut = () => {
    window.location.assign("/auth/sign-out");
  };

  return (
    <motion.header
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className={cn(
        "z-20 h-16 shrink-0 bg-surface/80 backdrop-blur-xl border-b border-border-light flex items-center justify-between px-6 transition-all duration-300",
      )}
    >
      <div className="flex items-center gap-4">
        <button
          onClick={toggleMobile}
          className="lg:hidden h-9 w-9 rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-tertiary transition-colors"
        >
          <Menu className="h-5 w-5" />
        </button>
        <SearchInput
          placeholder="Search requests, quotes, jobs..."
          className="w-72 hidden md:block"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggleTheme}
          className="relative h-9 w-9 rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-tertiary hover:text-text-primary transition-colors"
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
        <NotificationsMenu />
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("master-brain-open"))}
          className="h-9 w-9 rounded-lg flex items-center justify-center text-text-secondary hover:bg-primary/10 hover:text-primary transition-colors"
          title="Master Brain"
        >
          <Sparkles className="h-[18px] w-[18px]" />
        </button>
        <Link href="/settings" className="h-9 w-9 rounded-lg flex items-center justify-center text-text-secondary hover:bg-surface-tertiary hover:text-text-primary transition-colors">
          <Settings className="h-[18px] w-[18px]" />
        </Link>
        <div className="w-px h-6 bg-border mx-1" />
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
