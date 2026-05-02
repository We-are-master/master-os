import { Suspense } from "react";
import { JoinClient } from "./join-client";

export const metadata = {
  title: "Become a Fixfy Partner",
  description: "Join the Fixfy partner network. Apply in minutes and start earning.",
};

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ background: "linear-gradient(160deg, #020034 0%, #0D006E 55%, #E94A02 100%)" }}
        >
          <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      }
    >
      <JoinClient />
    </Suspense>
  );
}
