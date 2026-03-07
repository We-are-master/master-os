"use client";

import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "#fff",
            border: "1px solid #e7e5e4",
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
