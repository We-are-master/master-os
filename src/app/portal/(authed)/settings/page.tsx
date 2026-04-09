import { notFound } from "next/navigation";
import { requirePortalUserOrRedirect } from "@/lib/portal-auth";
import { fetchPortalAccount } from "@/lib/server-fetchers/portal-account";
import { PortalSettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

export default async function PortalSettingsPage() {
  const auth    = await requirePortalUserOrRedirect();
  const account = await fetchPortalAccount(auth.accountId);
  if (!account) notFound();

  return (
    <PortalSettingsClient
      account={account}
      portalUser={{
        email:     auth.portalUser.email,
        full_name: auth.portalUser.full_name,
      }}
    />
  );
}
