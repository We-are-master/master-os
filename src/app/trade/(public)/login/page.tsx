import { Suspense } from "react";
import { TradeLoginClient } from "./trade-login-client";

export const metadata = {
  title: "Fixfy Trade — Sign In",
  description: "Sign in to the Fixfy Trade partner network. Grow your revenue with vetted jobs and faster payouts.",
};

export default function TradeLoginPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ background: "#020040" }}
        >
          <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      }
    >
      <TradeLoginClient />
    </Suspense>
  );
}
