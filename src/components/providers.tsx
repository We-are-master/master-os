"use client";

import { Toaster } from "sonner";
import { DynamicFavicon } from "@/components/layout/dynamic-favicon";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DynamicFavicon />
      {children}
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "var(--card-bg)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-color)",
            borderRadius: "12px",
            fontSize: "13px",
            boxShadow: "0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05)",
          },
        }}
        richColors
        closeButton
      />
    </>
  );
}
