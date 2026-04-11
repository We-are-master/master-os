/**
 * Server Component shell for the /outreach page.
 *
 * Admin-only tool for composing and sending bulk emails to partners and
 * external addresses. Actual data loading happens client-side (partners +
 * templates) — the server shell just gates the route and renders the client.
 */

import { Suspense } from "react";
import { OutreachClient } from "./outreach-client";

export const dynamic = "force-dynamic";

export default function OutreachPage() {
  return (
    <Suspense fallback={null}>
      <OutreachClient />
    </Suspense>
  );
}
