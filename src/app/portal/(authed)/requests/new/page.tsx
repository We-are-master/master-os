import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import { NewRequestClient } from "./new-request-client";

export const dynamic = "force-dynamic";

export default async function NewRequestPage() {
  // Auth gate (also enforced by API). The page itself doesn't need any
  // server data — the form is fully client-side until submit.
  await requirePortalUserOrRedirect();
  return <NewRequestClient />;
}
