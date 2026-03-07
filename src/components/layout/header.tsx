"use client";

import { cn } from "@/lib/utils";
import { useSidebar } from "@/hooks/use-sidebar";
import { useProfile } from "@/hooks/use-profile";
import { SearchInput } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { motion } from "framer-motion";
import { Bell, Settings, Menu, LogOut } from "lucide-react";
import { signOut } from "@/services/auth";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

export function Header() {
  const { collapsed, toggleMobile } = useSidebar();
  const { profile } = useProfile();
  const router = useRouter();

  const displayName = profile?.full_name || "User";
  const displayRole = profile?.role
    ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1)
    : "";

  const handleSignOut = async () => {
    try {
      await signOut();
      router.push("/login");
      router.refresh();
    } catch {
      toast.error("Failed to sign out");
    }
  };

  return (
    <motion.header
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className={cn(
        "z-20 h-16 shrink-0 bg-white/80 backdrop-blur-xl border-b border-stone-100 flex items-center justify-between px-6 transition-all duration-300",
      )}
    >
      <div className="flex items-center gap-4">
        <button
          onClick={toggleMobile}
          className="lg:hidden h-9 w-9 rounded-lg flex items-center justify-center text-stone-500 hover:bg-stone-100 transition-colors"
        >
          <Menu className="h-5 w-5" />
        </button>
        <SearchInput
          placeholder="Search requests, quotes, jobs..."
          className="w-72 hidden md:block"
        />
      </div>

      <div className="flex items-center gap-2">
        <button className="relative h-9 w-9 rounded-lg flex items-center justify-center text-stone-500 hover:bg-stone-100 hover:text-stone-700 transition-colors">
          <Bell className="h-[18px] w-[18px]" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary animate-pulse-dot" />
        </button>
        <Link href="/settings" className="h-9 w-9 rounded-lg flex items-center justify-center text-stone-500 hover:bg-stone-100 hover:text-stone-700 transition-colors">
          <Settings className="h-[18px] w-[18px]" />
        </Link>
        <div className="w-px h-6 bg-stone-200 mx-1" />
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
          onClick={handleSignOut}
          className="h-9 w-9 rounded-lg flex items-center justify-center text-stone-400 hover:bg-red-50 hover:text-red-500 transition-colors"
          title="Sign out"
        >
          <LogOut className="h-[18px] w-[18px]" />
        </button>
      </div>
    </motion.header>
  );
}
