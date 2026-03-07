"use client";

import { createContext, useContext } from "react";

interface SidebarContextValue {
  collapsed: boolean;
  mobileOpen: boolean;
  toggle: () => void;
  toggleMobile: () => void;
  closeMobile: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}

export { SidebarContext };
