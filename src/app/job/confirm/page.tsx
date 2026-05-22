import { Suspense } from "react";
import { ConfirmClient } from "./confirm-client";

export const metadata = {
  title: "Confirm job — Fixfy",
  description: "Accept your assigned job in one tap.",
};

export default function ConfirmPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="w-10 h-10 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin" />
        </div>
      }
    >
      <ConfirmClient />
    </Suspense>
  );
}
