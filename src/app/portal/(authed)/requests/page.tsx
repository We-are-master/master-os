import { Suspense } from "react";
import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import { fetchAccountRequests } from "@/lib/server-fetchers/portal-requests";
import { RequestsClient } from "./requests-client";

export const dynamic = "force-dynamic";

export default async function PortalRequestsPage() {
  const auth = await requirePortalUserOrRedirect();
  const requests = await fetchAccountRequests(auth.accountId);
  return (
    <Suspense fallback={null}>
      <RequestsClient requests={requests} />
    </Suspense>
  );
}
