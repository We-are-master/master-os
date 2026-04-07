import { Suspense } from "react";
import { PartnerUploadClient } from "./partner-upload-client";

export default function PartnerUploadPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[var(--surface-secondary)] text-[var(--text-secondary)]">
          Loading…
        </div>
      }
    >
      <PartnerUploadClient />
    </Suspense>
  );
}
