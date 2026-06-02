import { Suspense } from "react";
import { OnHoldClient } from "./on-hold-client";

export const metadata = {
  title: "Resolve your job — Fixfy",
  description: "Send us a quick update and photos so we can get your job back on track.",
};

export default function OnHoldPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="w-10 h-10 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin" />
        </div>
      }
    >
      <OnHoldClient />
    </Suspense>
  );
}
